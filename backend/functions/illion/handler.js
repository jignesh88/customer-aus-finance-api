const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const dynamoClient = new DynamoDBClient();
const ddbDocClient = DynamoDBDocumentClient.from(dynamoClient);
const s3Client = new S3Client();

// Illion API configuration
const ILLION_API_URL = process.env.ILLION_API_URL;
const ILLION_API_KEY = process.env.ILLION_API_KEY;
const TABLE_NAME = process.env.FINANCIAL_DATA_TABLE || 'financial-data-dev';
const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'financial-data-dev';

/**
 * Initiate Illion BankStatements request
 */
exports.initiate = async (event) => {
  try {
    const userId = event.requestContext.authorizer.claims.sub;
    const userData = JSON.parse(event.body);
    
    // Validate required fields
    if (!userData.name || !userData.email || !userData.mobileNumber) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': true
        },
        body: JSON.stringify({
          message: 'Name, email, and mobile number are required'
        })
      };
    }
    
    // Generate a unique request ID
    const requestId = uuidv4();
    
    // Set up the webhook URL (replace with your API Gateway URL)
    const webhookUrl = `https://your-api-gateway-url/dev/illion/webhook?userId=${userId}&requestId=${requestId}`;
    
    // Create Illion BankStatements request
    const response = await axios.post(
      `${ILLION_API_URL}/bankstatements/request`,
      {
        reference: requestId,
        client: {
          name: userData.name,
          email: userData.email,
          phone: userData.mobileNumber
        },
        redirectUrl: `https://your-frontend-url/bankstatements/callback?requestId=${requestId}`,
        webhookUrl: webhookUrl
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ILLION_API_KEY
        }
      }
    );
    
    // Store request data in DynamoDB
    const timestamp = new Date().toISOString();
    await ddbDocClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `USER#${userId}`,
          SK: `BANKSTATEMENT#ILLION#${requestId}`,
          requestId,
          name: userData.name,
          email: userData.email,
          mobileNumber: userData.mobileNumber,
          status: 'INITIATED',
          redirectUrl: response.data.redirectUrl,
          createdAt: timestamp,
          updatedAt: timestamp
        }
      })
    );
    
    return {
      statusCode: 201,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true
      },
      body: JSON.stringify({
        requestId,
        redirectUrl: response.data.redirectUrl
      })
    };
  } catch (error) {
    console.error('Error initiating Illion BankStatements request:', error);
    
    return {
      statusCode: error.response?.status || 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true
      },
      body: JSON.stringify({
        message: 'Failed to initiate bank statements request',
        error: error.message
      })
    };
  }
};

/**
 * Handle Illion BankStatements webhook
 */
exports.webhook = async (event) => {
  try {
    const { userId, requestId } = event.queryStringParameters;
    const webhookData = JSON.parse(event.body);
    
    // Validate webhook data
    if (!webhookData.reference || webhookData.reference !== requestId) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: 'Invalid request reference'
        })
      };
    }
    
    // Get request details from DynamoDB
    const getRequestResult = await ddbDocClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `USER#${userId}`,
          SK: `BANKSTATEMENT#ILLION#${requestId}`
        }
      })
    );
    
    if (!getRequestResult.Item) {
      return {
        statusCode: 404,
        body: JSON.stringify({
          message: 'Bank statement request not found'
        })
      };
    }
    
    // Download PDF and store in S3 if available
    if (webhookData.status === 'COMPLETED' && webhookData.pdfUrl) {
      // Download PDF from Illion
      const pdfResponse = await axios.get(webhookData.pdfUrl, {
        responseType: 'arraybuffer',
        headers: {
          'x-api-key': ILLION_API_KEY
        }
      });
      
      // Store PDF in S3
      const pdfKey = `${userId}/bankstatements/${requestId}.pdf`;
      await s3Client.send(
        new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: pdfKey,
          Body: pdfResponse.data,
          ContentType: 'application/pdf'
        })
      );
      
      webhookData.pdfKey = pdfKey;
    }
    
    // Download JSON data and store in S3 if available
    if (webhookData.status === 'COMPLETED' && webhookData.jsonUrl) {
      // Download JSON from Illion
      const jsonResponse = await axios.get(webhookData.jsonUrl, {
        headers: {
          'x-api-key': ILLION_API_KEY
        }
      });
      
      // Store JSON in S3
      const jsonKey = `${userId}/bankstatements/${requestId}.json`;
      await s3Client.send(
        new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: jsonKey,
          Body: JSON.stringify(jsonResponse.data),
          ContentType: 'application/json'
        })
      );
      
      webhookData.jsonKey = jsonKey;
      
      // Extract account information from JSON data
      if (jsonResponse.data.accounts && jsonResponse.data.accounts.length > 0) {
        for (const account of jsonResponse.data.accounts) {
          await ddbDocClient.send(
            new PutCommand({
              TableName: TABLE_NAME,
              Item: {
                PK: `USER#${userId}`,
                SK: `ACCOUNT#ILLION#${account.accountNumber}`,
                accountData: account,
                provider: 'ILLION',
                requestId,
                updatedAt: new Date().toISOString()
              }
            })
          );
          
          // Store transactions if available
          if (account.transactions && account.transactions.length > 0) {
            for (const transaction of account.transactions) {
              const transactionId = uuidv4(); // Generate ID for transactions
              await ddbDocClient.send(
                new PutCommand({
                  TableName: TABLE_NAME,
                  Item: {
                    PK: `USER#${userId}`,
                    SK: `TRANSACTION#ILLION#${account.accountNumber}#${transactionId}`,
                    accountId: account.accountNumber,
                    transactionData: transaction,
                    provider: 'ILLION',
                    requestId,
                    updatedAt: new Date().toISOString()
                  }
                })
              );
            }
          }
        }
      }
    }
    
    // Update request status in DynamoDB
    await ddbDocClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `USER#${userId}`,
          SK: `BANKSTATEMENT#ILLION#${requestId}`
        },
        UpdateExpression: 'SET #status = :status, webhookData = :webhookData, #updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#updatedAt': 'updatedAt'
        },
        ExpressionAttributeValues: {
          ':status': webhookData.status,
          ':webhookData': webhookData,
          ':updatedAt': new Date().toISOString()
        }
      })
    );
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Webhook processed successfully'
      })
    };
  } catch (error) {
    console.error('Error processing Illion webhook:', error);
    
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Failed to process webhook',
        error: error.message
      })
    };
  }
};

/**
 * Get bank statements
 */
exports.getBankStatements = async (event) => {
  try {
    const userId = event.requestContext.authorizer.claims.sub;
    const requestId = event.pathParameters.requestId;
    
    // Get request details from DynamoDB
    const getRequestResult = await ddbDocClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `USER#${userId}`,
          SK: `BANKSTATEMENT#ILLION#${requestId}`
        }
      })
    );
    
    if (!getRequestResult.Item) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': true
        },
        body: JSON.stringify({
          message: 'Bank statement request not found'
        })
      };
    }
    
    const request = getRequestResult.Item;
    
    // If the request is still in progress, return status
    if (request.status !== 'COMPLETED') {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': true
        },
        body: JSON.stringify({
          requestId,
          status: request.status,
          createdAt: request.createdAt,
          updatedAt: request.updatedAt
        })
      };
    }
    
    // Generate pre-signed URLs for PDF and JSON if available
    let pdfUrl = null;
    let jsonUrl = null;
    
    if (request.webhookData && request.webhookData.pdfKey) {
      const pdfCommand = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: request.webhookData.pdfKey
      });
      pdfUrl = await getSignedUrl(s3Client, pdfCommand, { expiresIn: 3600 }); // 1 hour
    }
    
    if (request.webhookData && request.webhookData.jsonKey) {
      const jsonCommand = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: request.webhookData.jsonKey
      });
      jsonUrl = await getSignedUrl(s3Client, jsonCommand, { expiresIn: 3600 }); // 1 hour
    }
    
    // Get accounts and transactions from this request
    const queryAccountsResult = await ddbDocClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `USER#${userId}`,
          ':sk': 'ACCOUNT#ILLION#'
        },
        FilterExpression: 'requestId = :requestId',
        ExpressionAttributeValues: {
          ':pk': `USER#${userId}`,
          ':sk': 'ACCOUNT#ILLION#',
          ':requestId': requestId
        }
      })
    );
    
    const accounts = queryAccountsResult.Items || [];
    
    // Format response
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true
      },
      body: JSON.stringify({
        requestId,
        status: request.status,
        createdAt: request.createdAt,
        updatedAt: request.updatedAt,
        pdfUrl,
        jsonUrl,
        accounts: accounts.map(account => ({
          accountNumber: account.accountData.accountNumber,
          accountName: account.accountData.accountName,
          bsb: account.accountData.bsb,
          institution: account.accountData.institution,
          accountType: account.accountData.accountType,
          balance: account.accountData.balance,
          availableBalance: account.accountData.availableBalance,
          currency: account.accountData.currency || 'AUD'
        }))
      })
    };
  } catch (error) {
    console.error('Error getting bank statements:', error);
    
    return {
      statusCode: error.response?.status || 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true
      },
      body: JSON.stringify({
        message: 'Failed to get bank statements',
        error: error.message
      })
    };
  }
};

/**
 * Get transactions for an account from bank statements
 */
exports.getAccountTransactions = async (event) => {
  try {
    const userId = event.requestContext.authorizer.claims.sub;
    const { requestId, accountNumber } = event.pathParameters;
    
    // Query transactions for this account
    const queryTransactionsResult = await ddbDocClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `USER#${userId}`,
          ':sk': `TRANSACTION#ILLION#${accountNumber}#`
        },
        FilterExpression: 'requestId = :requestId',
        ExpressionAttributeValues: {
          ':pk': `USER#${userId}`,
          ':sk': `TRANSACTION#ILLION#${accountNumber}#`,
          ':requestId': requestId
        }
      })
    );
    
    const transactions = queryTransactionsResult.Items || [];
    
    // Format transactions
    const formattedTransactions = transactions.map(item => ({
      date: item.transactionData.date,
      description: item.transactionData.description,
      amount: item.transactionData.amount,
      balance: item.transactionData.balance,
      type: item.transactionData.type,
      category: item.transactionData.category
    }));
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true
      },
      body: JSON.stringify({
        accountNumber,
        requestId,
        transactions: formattedTransactions
      })
    };
  } catch (error) {
    console.error('Error getting account transactions:', error);
    
    return {
      statusCode: error.response?.status || 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true
      },
      body: JSON.stringify({
        message: 'Failed to get account transactions',
        error: error.message
      })
    };
  }
};