const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient();
const ddbDocClient = DynamoDBDocumentClient.from(client);

// Basiq API configuration
const BASIQ_API_URL = process.env.BASIQ_API_URL || 'https://au-api.basiq.io';
const BASIQ_API_KEY = process.env.BASIQ_API_KEY;
const TABLE_NAME = process.env.FINANCIAL_DATA_TABLE || 'financial-data-dev';

/**
 * Get Basiq access token
 */
const getAccessToken = async () => {
  try {
    const response = await axios.post(
      `${BASIQ_API_URL}/token`,
      {},
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${Buffer.from(BASIQ_API_KEY).toString('base64')}`
        }
      }
    );
    
    return response.data.access_token;
  } catch (error) {
    console.error('Error getting Basiq access token:', error);
    throw new Error('Failed to authenticate with Basiq API');
  }
};

/**
 * Initiate Basiq connection
 */
exports.connect = async (event) => {
  try {
    const userId = event.requestContext.authorizer.claims.sub;
    const userData = JSON.parse(event.body);
    
    // Validate required fields
    if (!userData.email || !userData.mobile) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': true
        },
        body: JSON.stringify({
          message: 'Email and mobile are required'
        })
      };
    }
    
    // Get access token
    const accessToken = await getAccessToken();
    
    // Check if user exists in Basiq
    let basiqUserId;
    let basiqUserExists = false;
    
    // First check in our database
    const getUserResult = await ddbDocClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `USER#${userId}`,
          SK: 'BASIQ#USERINFO'
        }
      })
    );
    
    if (getUserResult.Item && getUserResult.Item.basiqUserId) {
      basiqUserId = getUserResult.Item.basiqUserId;
      basiqUserExists = true;
    }
    
    // If user doesn't exist in our database, try to find by email in Basiq
    if (!basiqUserExists) {
      try {
        const usersResponse = await axios.get(
          `${BASIQ_API_URL}/users?filter=email.eq('${userData.email}')`,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            }
          }
        );
        
        if (usersResponse.data.data && usersResponse.data.data.length > 0) {
          basiqUserId = usersResponse.data.data[0].id;
          basiqUserExists = true;
        }
      } catch (error) {
        // Ignore errors - we'll create a new user
        console.log('User not found in Basiq, will create new user');
      }
    }
    
    // Create a new user in Basiq if doesn't exist
    if (!basiqUserExists) {
      const createUserResponse = await axios.post(
        `${BASIQ_API_URL}/users`,
        {
          email: userData.email,
          mobile: userData.mobile
        },
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      basiqUserId = createUserResponse.data.id;
    }
    
    // Create a connection URL
    const connectionResponse = await axios.post(
      `${BASIQ_API_URL}/users/${basiqUserId}/connections/consent`,
      {
        mobile: userData.mobile,
        callbackUrl: `https://app.example.com/callback?user=${userId}` // Replace with your frontend callback URL
      },
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    const connectionId = connectionResponse.data.id;
    const authUrl = connectionResponse.data.url;
    
    // Store Basiq user info in DynamoDB
    const timestamp = new Date().toISOString();
    await ddbDocClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `USER#${userId}`,
          SK: 'BASIQ#USERINFO',
          basiqUserId,
          email: userData.email,
          mobile: userData.mobile,
          lastConnectionId: connectionId,
          createdAt: timestamp,
          updatedAt: timestamp
        }
      })
    );
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true
      },
      body: JSON.stringify({
        connectionId,
        url: authUrl
      })
    };
  } catch (error) {
    console.error('Error initiating Basiq connection:', error);
    
    return {
      statusCode: error.response?.status || 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true
      },
      body: JSON.stringify({
        message: 'Failed to initiate Basiq connection',
        error: error.message
      })
    };
  }
};

/**
 * Get transactions for an account
 */
exports.getTransactions = async (event) => {
  try {
    const userId = event.requestContext.authorizer.claims.sub;
    const accountId = event.pathParameters.accountId;
    
    // Get user info from DynamoDB
    const getUserResult = await ddbDocClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `USER#${userId}`,
          SK: 'BASIQ#USERINFO'
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
          message: 'Basiq connection not found. Please connect first.'
        })
      };
    }
    
    const basiqUserId = getUserResult.Item.basiqUserId;
    
    // Get access token
    const accessToken = await getAccessToken();
    
    // Get transactions from Basiq
    const { from, to, page, size } = event.queryStringParameters || {};
    
    let url = `${BASIQ_API_URL}/users/${basiqUserId}/accounts/${accountId}/transactions`;
    const queryParams = [];
    
    if (from) queryParams.push(`filter=transaction.postDate.gt('${from}')`);
    if (to) queryParams.push(`filter=transaction.postDate.lt('${to}')`);
    if (page) queryParams.push(`page=${page}`);
    if (size) queryParams.push(`size=${size || 100}`);
    
    if (queryParams.length > 0) {
      url += `?${queryParams.join('&')}`;
    }
    
    const transactionsResponse = await axios.get(
      url,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    const transactions = transactionsResponse.data.data;
    
    // Store transactions in DynamoDB
    for (const transaction of transactions) {
      await ddbDocClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            PK: `USER#${userId}`,
            SK: `TRANSACTION#BASIQ#${accountId}#${transaction.id}`,
            accountId,
            transactionData: transaction,
            provider: 'BASIQ',
            updatedAt: new Date().toISOString()
          }
        })
      );
    }
    
    // Format the transactions for API response
    const formattedTransactions = transactions.map(transaction => ({
      transactionId: transaction.id,
      status: transaction.status,
      description: transaction.description,
      postingDateTime: transaction.postDate,
      valueDateTime: transaction.transactionDate,
      executionDateTime: transaction.transactionDate,
      amount: transaction.amount,
      currency: transaction.currency || 'AUD',
      reference: transaction.reference || '',
      merchantName: transaction.institution.shortName || '',
      merchantCategoryCode: transaction.class.code || '',
      transactionType: transaction.type,
      category: transaction.class.title || ''
    }));
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true
      },
      body: JSON.stringify({
        transactions: formattedTransactions,
        links: transactionsResponse.data.links,
        size: transactionsResponse.data.size,
        totalCount: transactionsResponse.data.totalCount
      })
    };
  } catch (error) {
    console.error('Error getting Basiq transactions:', error);
    
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

/**
 * Get accounts from Basiq
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
          SK: 'BASIQ#USERINFO'
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
          message: 'Basiq connection not found. Please connect first.'
        })
      };
    }
    
    const basiqUserId = getUserResult.Item.basiqUserId;
    
    // Get access token
    const accessToken = await getAccessToken();
    
    // Get accounts from Basiq
    const accountsResponse = await axios.get(
      `${BASIQ_API_URL}/users/${basiqUserId}/accounts`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    const accounts = accountsResponse.data.data;
    
    // Store accounts in DynamoDB
    for (const account of accounts) {
      await ddbDocClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            PK: `USER#${userId}`,
            SK: `ACCOUNT#BASIQ#${account.id}`,
            accountData: account,
            provider: 'BASIQ',
            updatedAt: new Date().toISOString()
          }
        })
      );
    }
    
    // Format the accounts for API response
    const formattedAccounts = accounts.map(account => ({
      accountId: account.id,
      displayName: account.name,
      nickname: account.accountNumber || account.name,
      accountType: mapBasiqAccountType(account.class.type),
      accountStatus: 'ACTIVE',
      balance: {
        amount: account.balance,
        currency: account.currency || 'AUD'
      },
      balanceUType: account.class.type === 'credit' ? 'lending' : 'deposit',
      institution: account.institution.shortName || account.institution.name,
      accountNumber: account.accountNumber || ''
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
    console.error('Error getting Basiq accounts:', error);
    
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
 * Map Basiq account type to CDR account type
 */
const mapBasiqAccountType = (basiqType) => {
  switch (basiqType) {
    case 'savings':
      return 'SAVINGS';
    case 'checking':
    case 'transaction':
      return 'TRANSACTION';
    case 'credit':
      return 'CREDITCARD';
    case 'loan':
    case 'mortgage':
      return 'LOAN';
    case 'term_deposit':
      return 'TERMDEPOSIT';
    default:
      return basiqType.toUpperCase();
  }
};