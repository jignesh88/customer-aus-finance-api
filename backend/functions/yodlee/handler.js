const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient();
const ddbDocClient = DynamoDBDocumentClient.from(client);

// Yodlee API configuration
const YODLEE_API_URL = process.env.YODLEE_API_URL;
const YODLEE_CLIENT_ID = process.env.YODLEE_CLIENT_ID;
const YODLEE_CLIENT_SECRET = process.env.YODLEE_CLIENT_SECRET;
const TABLE_NAME = process.env.FINANCIAL_DATA_TABLE || 'financial-data-dev';

/**
 * Get Yodlee access token
 */
const getAccessToken = async () => {
  try {
    const response = await axios.post(
      `${YODLEE_API_URL}/auth/token`,
      {
        clientId: YODLEE_CLIENT_ID,
        secret: YODLEE_CLIENT_SECRET
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Api-Version': '1.1'
        }
      }
    );
    
    return response.data.token;
  } catch (error) {
    console.error('Error getting Yodlee access token:', error);
    throw new Error('Failed to authenticate with Yodlee API');
  }
};

/**
 * Initiate Yodlee connection
 */
exports.connect = async (event) => {
  try {
    const userId = event.requestContext.authorizer.claims.sub;
    
    // Get access token
    const accessToken = await getAccessToken();
    
    // Create a new user in Yodlee (if not already exists)
    const userResponse = await axios.post(
      `${YODLEE_API_URL}/user/register`,
      {
        user: {
          loginName: `user_${userId}`,
          email: `user_${userId}@example.com`,
          preferences: {
            language: 'en',
            currency: 'AUD',
            timeZone: 'Australia/Sydney'
          }
        }
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Api-Version': '1.1',
          'Authorization': `Bearer ${accessToken}`
        }
      }
    );
    
    const yodleeUserId = userResponse.data.user.id;
    
    // Get FastLink token
    const fastlinkResponse = await axios.post(
      `${YODLEE_API_URL}/fastlink/token`,
      {
        appIds: ['10003600'],
        tokenExpiryTime: 1800 // 30 minutes
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Api-Version': '1.1',
          'Authorization': `Bearer ${accessToken}`
        }
      }
    );
    
    const fastlinkToken = fastlinkResponse.data.token;
    
    // Store Yodlee user info in DynamoDB
    const timestamp = new Date().toISOString();
    await ddbDocClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `USER#${userId}`,
          SK: 'YODLEE#USERINFO',
          yodleeUserId,
          loginName: `user_${userId}`,
          createdAt: timestamp,
          updatedAt: timestamp
        }
      })
    );
    
    // Construct the FastLink URL
    const fastlinkUrl = `${YODLEE_API_URL}/fastlink/?token=${fastlinkToken}&configName=Aggregation`;
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true
      },
      body: JSON.stringify({
        url: fastlinkUrl,
        token: fastlinkToken,
        expiresAt: new Date(Date.now() + 1800000).toISOString() // 30 minutes
      })
    };
  } catch (error) {
    console.error('Error initiating Yodlee connection:', error);
    
    return {
      statusCode: error.response?.status || 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true
      },
      body: JSON.stringify({
        message: 'Failed to initiate Yodlee connection',
        error: error.message
      })
    };
  }
};

/**
 * Get accounts from Yodlee
 */
exports.getAccounts = async (event) => {
  try {
    const userId = event.requestContext.authorizer.claims.sub;
    
    // Get user info from DynamoDB
    const getUserResult = await ddbDocClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `USER#${userId}`,
          SK: 'YODLEE#USERINFO'
        }
      })
    );
    
    if (!getUserResult.Item) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': true
        },
        body: JSON.stringify({
          message: 'Yodlee connection not found. Please connect first.'
        })
      };
    }
    
    const yodleeUserId = getUserResult.Item.yodleeUserId;
    
    // Get access token
    const accessToken = await getAccessToken();
    
    // Get accounts from Yodlee
    const accountsResponse = await axios.get(
      `${YODLEE_API_URL}/accounts`,
      {
        headers: {
          'Api-Version': '1.1',
          'Authorization': `Bearer ${accessToken}`,
          'loginName': getUserResult.Item.loginName
        }
      }
    );
    
    const accounts = accountsResponse.data.account;
    
    // Store accounts in DynamoDB
    for (const account of accounts) {
      await ddbDocClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            PK: `USER#${userId}`,
            SK: `ACCOUNT#YODLEE#${account.id}`,
            accountData: account,
            provider: 'YODLEE',
            updatedAt: new Date().toISOString()
          }
        })
      );
    }
    
    // Format the accounts for API response
    const formattedAccounts = accounts.map(account => ({
      accountId: account.id.toString(),
      displayName: account.accountName,
      nickname: account.nickname || account.accountName,
      accountType: account.accountType,
      accountStatus: 'ACTIVE',
      balance: {
        amount: account.balance.amount.toString(),
        currency: account.balance.currency
      },
      balanceUType: 'deposit',
      depositRate: account.interestRate || '',
      lendingRate: account.apr || '',
      providerName: account.providerName,
      providerLogo: account.providerLogo
    }));
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true
      },
      body: JSON.stringify({
        accounts: formattedAccounts
      })
    };
  } catch (error) {
    console.error('Error getting Yodlee accounts:', error);
    
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