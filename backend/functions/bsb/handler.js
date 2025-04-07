const axios = require('axios');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient();
const ddbDocClient = DynamoDBDocumentClient.from(client);

// BSB API configuration
const BSB_LOOKUP_API_URL = process.env.BSB_LOOKUP_API_URL;
const BSB_LOOKUP_API_KEY = process.env.BSB_LOOKUP_API_KEY;
const TABLE_NAME = process.env.FINANCIAL_DATA_TABLE || 'financial-data-dev';
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

/**
 * Lookup BSB information
 */
exports.lookup = async (event) => {
  try {
    const bsbCode = event.pathParameters.bsbCode;
    
    // Input validation
    if (!bsbCode || !/^\d{6}$/.test(bsbCode)) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          message: 'Invalid BSB code. BSB must be a 6-digit number.'
        })
      };
    }

    // Check cache first
    const cachedResult = await ddbDocClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `BSB#${bsbCode}`,
          SK: 'DETAILS'
        }
      })
    );

    // Return cached result if valid and not expired
    if (cachedResult.Item && cachedResult.Item.expiresAt > Date.now()) {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          bsb: bsbCode,
          ...cachedResult.Item.details,
          cachedAt: cachedResult.Item.updatedAt
        })
      };
    }

    // Call BSB Lookup API
    const response = await axios.get(
      `${BSB_LOOKUP_API_URL}/bsb/${bsbCode}`,
      {
        headers: {
          'x-api-key': BSB_LOOKUP_API_KEY,
          'Accept': 'application/json'
        }
      }
    );

    const bsbDetails = response.data;
    
    // Cache the result in DynamoDB
    await ddbDocClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `BSB#${bsbCode}`,
          SK: 'DETAILS',
          details: bsbDetails,
          updatedAt: Date.now(),
          expiresAt: Date.now() + CACHE_TTL
        }
      })
    );

    // Validate BSB details
    const isValid = bsbDetails.status === 'active' || bsbDetails.status === 'ACTIVE';

    // Format response
    const result = {
      bsb: bsbCode,
      financialInstitution: bsbDetails.financialInstitution || bsbDetails.institutionName,
      branch: bsbDetails.branch || bsbDetails.branchName,
      address: bsbDetails.address,
      city: bsbDetails.city || bsbDetails.suburb,
      state: bsbDetails.state,
      postcode: bsbDetails.postcode,
      status: bsbDetails.status,
      isValid
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(result)
    };
  } catch (error) {
    console.error('Error looking up BSB code:', error);
    
    // Handle specific error cases
    if (error.response?.status === 404) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          message: `BSB code ${event.pathParameters.bsbCode} not found`,
          isValid: false
        })
      };
    }
    
    return {
      statusCode: error.response?.status || 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        message: 'Failed to lookup BSB code',
        error: error.message,
        isValid: false
      })
    };
  }
};