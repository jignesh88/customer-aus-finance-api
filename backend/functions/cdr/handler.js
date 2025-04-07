const axios = require('axios');
const jwt = require('jsonwebtoken');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient();
const ddbDocClient = DynamoDBDocumentClient.from(client);

// CDR API configuration
const CDR_API_URL = process.env.CDR_API_URL;
const CDR_CLIENT_ID = process.env.CDR_CLIENT_ID;
const CDR_CLIENT_SECRET = process.env.CDR_CLIENT_SECRET;
const TABLE_NAME = process.env.FINANCIAL_DATA_TABLE || 'financial-data-dev';

/**
 * Get access token for CDR API
 */
const getAccessToken = async (userId) => {
  try {
    // First check if we have a valid token in DynamoDB
    const getTokenResult = await ddbDocClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `USER#${userId}`,
          SK: 'TOKEN#CDR'
        }
      })
    );

    // Check if token exists and is not expired
    if (getTokenResult.Item) {
      const { accessToken, expiresAt } = getTokenResult.Item;
      if (expiresAt > Date.now()) {
        return accessToken;
      }
    }

    // Get new token from CDR API
    const response = await axios.post(
      `${CDR_API_URL}/cds-au/v1/banking/token`,
      {
        grant_type: 'client_credentials',
        scope: 'bank:accounts.basic:read bank:transactions:read',
        client_id: CDR_CLIENT_ID,
        client_secret: CDR_CLIENT_SECRET
      },
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    // Store token in DynamoDB
    const { access_token, expires_in } = response.data;
    const expiresAt = Date.now() + (expires_in * 1000 * 0.9); // 90% of the expiry time

    await ddbDocClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `USER#${userId}`,
          SK: 'TOKEN#CDR',
          accessToken: access_token,
          expiresAt,
          createdAt: Date.now()
        }
      })
    );

    return access_token;
  } catch (error) {
    console.error('Error getting CDR API access token:', error);
    throw new Error('Failed to authenticate with CDR API');
  }
};

/**
 * Get user's bank accounts from CDR API
 */
exports.getAccounts = async (event) => {
  try {
    const userId = event.requestContext.authorizer.claims.sub;
    const accessToken = await getAccessToken(userId);

    const response = await axios.get(
      `${CDR_API_URL}/cds-au/v1/banking/accounts`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'x-v': '2'
        }
      }
    );

    // Store account data in DynamoDB
    const accounts = response.data.data.accounts;
    for (const account of accounts) {
      await ddbDocClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            PK: `USER#${userId}`,
            SK: `ACCOUNT#CDR#${account.accountId}`,
            accountData: account,
            provider: 'CDR',
            updatedAt: Date.now()
          }
        })
      );
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true
      },
      body: JSON.stringify({
        accounts
      })
    };
  } catch (error) {
    console.error('Error getting accounts from CDR API:', error);

    return {
      statusCode: error.response?.status || 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true
      },
      body: JSON.stringify({
        message: 'Failed to retrieve accounts',
        error: error.message
      })
    };
  }
};

/**
 * Get account transactions from CDR API
 */
exports.getTransactions = async (event) => {
  try {
    const userId = event.requestContext.authorizer.claims.sub;
    const accountId = event.pathParameters.accountId;
    const accessToken = await getAccessToken(userId);

    // Optional query parameters
    const { oldest_time, newest_time, min_amount, max_amount, page, page_size } = event.queryStringParameters || {};
    
    let url = `${CDR_API_URL}/cds-au/v1/banking/accounts/${accountId}/transactions`;
    
    // Add query parameters if provided
    const queryParams = [];
    if (oldest_time) queryParams.push(`oldest-time=${oldest_time}`);
    if (newest_time) queryParams.push(`newest-time=${newest_time}`);
    if (min_amount) queryParams.push(`min-amount=${min_amount}`);
    if (max_amount) queryParams.push(`max-amount=${max_amount}`);
    if (page) queryParams.push(`page=${page}`);
    if (page_size) queryParams.push(`page-size=${page_size}`);
    
    if (queryParams.length > 0) {
      url += `?${queryParams.join('&')}`;
    }

    const response = await axios.get(
      url,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'x-v': '2'
        }
      }
    );

    // Store transaction data in DynamoDB
    const transactions = response.data.data.transactions;
    for (const transaction of transactions) {
      await ddbDocClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            PK: `USER#${userId}`,
            SK: `TRANSACTION#CDR#${accountId}#${transaction.transactionId}`,
            accountId,
            transactionData: transaction,
            provider: 'CDR',
            updatedAt: Date.now()
          }
        })
      );
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true
      },
      body: JSON.stringify({
        transactions,
        links: response.data.links,
        meta: response.data.meta
      })
    };
  } catch (error) {
    console.error('Error getting transactions from CDR API:', error);

    return {
      statusCode: error.response?.status || 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true
      },
      body: JSON.stringify({
        message: 'Failed to retrieve transactions',
        error: error.message
      })
    };
  }
};