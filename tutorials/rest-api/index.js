'use strict';

// This is an example application that illustrates how to upload CityGML data
// to Cesium ion using Node.js. For a full walk-through of this example, see
// https://cesium.com/docs/tutorials/rest-api/

const AWS = require('aws-sdk');
const fs = require('fs');
const request = require('request-promise');

// Replace <your_access_token> below with a token from your ion account.
// This example requires a token with assets:list, assets:read, and assets:write scopes.
// Tokens page: https://cesium.com/dev-ion/tokens
const accessToken = '<your_access_token>';

// Sample data is already included in this repository, but you can modify the below
// path to point to any CityGML data you would like to upload.
const input = 'Reichstag.zip';

async function main() {

    // Step 1 POST information about the data to /v1/assets
    console.log('Creating new asset: Reichstag');
    const response = await request({
        url: 'https://api.cesium.com/v1/assets',
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        json: true,
        body: {
            name: 'Reichstag',
            description: 'See [Wikipedia](https://en.wikipedia.org/?curid=217577).',
            type: '3DTILES',
            options: {
                sourceType: 'CITYGML',
                clampToTerrain: true,
                baseTerrainId: 1
            }
        }
    });

    // Step 2 Use response.uploadLocation to upoad the file to ion
    console.log('Asset created. Uploading Reichstag.zip');
    const uploadLocation = response.uploadLocation;
    const s3 = new AWS.S3({
        apiVersion: '2006-03-01',
        region: 'us-east-1',
        signatureVersion: 'v4',
        endpoint: uploadLocation.endpoint,
        credentials: new AWS.Credentials(
            uploadLocation.accessKey,
            uploadLocation.secretAccessKey,
            uploadLocation.sessionToken)
    });

    await s3.upload({
        Body: fs.createReadStream(input),
        Bucket: uploadLocation.bucket,
        Key: `${uploadLocation.prefix}Reichstag.zip`
    }).on('httpUploadProgress', function (progress) {
        console.log(`Upload: ${((progress.loaded / progress.total) * 100).toFixed(2)}%`);
    }).promise();

    // Step 3 Tell ion we are done uploading files.
    const onComplete = response.onComplete;
    await request({
        url: onComplete.url,
        method: onComplete.method,
        headers: { Authorization: `Bearer ${accessToken}` },
        json: true,
        body: onComplete.fields
    });

    // Step 4 Monitor the tiling process and report when it is finished.

    async function waitUntilReady() {
        const assetId = response.assetMetadata.id;

        // Issue a GET request for the metadata
        const assetMetadata = await request({
            url: `https://api.cesium.com/v1/assets/${assetId}`,
            headers: { Authorization: `Bearer ${accessToken}` },
            json: true
        });

        const status = assetMetadata.status;
        if (status === 'COMPLETE') {
            console.log('Asset tiled successfully');
            console.log(`View in ion: https://cesium.com/ion/assets/${assetMetadata.id}`);
        } else if (status === 'DATA_ERROR') {
            console.log('ion detected a problem with the uploaded data.');
        } else if (status === 'ERROR') {
            console.log('An unknown tiling error occurred, please contact support@cesium.com.');
        } else {
            if (status === 'NOT_STARTED') {
                console.log('Tiling pipeline initializing.');
            } else { // IN_PROGRESS
                console.log(`Asset is ${assetMetadata.percentComplete}% complete.`);
            }

            // Not done yet, check again in 10 seconds
            setTimeout(waitUntilReady, 10000);
        }
    }

    waitUntilReady();
}

main().catch(e => {
    console.log(e.message);
});
