const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient();
const ddbDocClient = DynamoDBDocumentClient.from(client);

// NPP API configuration
const NPP_API_URL = process.env.NPP_API_URL;
const NPP_API_KEY = process.env.NPP_API_KEY;
const TABLE_NAME = process.env.FINANCIAL_DATA_TABLE || 'financial-data-dev';

/**
 * Create a new NPP payment
 */
exports.createPayment = async (event) => {
  try {
    const userId = event.requestContext.authorizer.claims.sub;
    const paymentDetails = JSON.parse(event.body);
    
    // Validate required fields
    if (!paymentDetails.sourceAccount || !paymentDetails.sourceAccount.accountId) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': true
        },
        body: JSON.stringify({
          message: 'Source account ID is required'
        })
      };
    }
    
    if (!paymentDetails.destinationAccount || 
        !paymentDetails.destinationAccount.accountName || 
        !paymentDetails.destinationAccount.bsb || 
        !paymentDetails.destinationAccount.accountNumber) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': true
        },
        body: JSON.stringify({
          message: 'Destination account details are incomplete'
        })
      };
    }
    
    if (!paymentDetails.amount || isNaN(parseFloat(paymentDetails.amount)) || parseFloat(paymentDetails.amount) <= 0) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': true
        },
        body: JSON.stringify({
          message: 'Valid payment amount is required'
        })
      };
    }

    // Generate a unique payment ID
    const paymentId = uuidv4();
    const endToEndId = paymentDetails.endToEndId || uuidv4();
    
    // Prepare the NPP payment request
    const nppRequest = {
      endToEndId,
      amount: parseFloat(paymentDetails.amount).toFixed(2),
      currency: paymentDetails.currency || 'AUD',
      fromAccount: {
        accountId: paymentDetails.sourceAccount.accountId
      },
      toAccount: {
        name: paymentDetails.destinationAccount.accountName,
        bsb: paymentDetails.destinationAccount.bsb.replace(/[^0-9]/g, ''),
        accountNumber: paymentDetails.destinationAccount.accountNumber.replace(/[^0-9]/g, '')
      },
      description: paymentDetails.description || 'Payment',
      reference: paymentDetails.paymentReference || ''
    };
    
    // Call NPP API to create payment
    const response = await axios.post(
      `${NPP_API_URL}/payments`,
      nppRequest,
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': NPP_API_KEY
        }
      }
    );
    
    // Store payment data in DynamoDB
    const timestamp = new Date().toISOString();
    await ddbDocClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `USER#${userId}`,
          SK: `PAYMENT#NPP#${paymentId}`,
          paymentId,
          sourceAccountId: paymentDetails.sourceAccount.accountId,
          destinationAccount: paymentDetails.destinationAccount,
          amount: paymentDetails.amount,
          currency: paymentDetails.currency || 'AUD',
          description: paymentDetails.description,
          paymentReference: paymentDetails.paymentReference,
          status: response.data.status || 'PENDING',
          nppReference: response.data.nppReference || endToEndId,
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
        paymentId,
        status: response.data.status || 'PENDING',
        nppReference: response.data.nppReference || endToEndId,
        createdAt: timestamp
      })
    };
  } catch (error) {
    console.error('Error creating NPP payment:', error);
    
    return {
      statusCode: error.response?.status || 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true
      },
      body: JSON.stringify({
        message: 'Failed to create payment',
        error: error.message
      })
    };
  }
};

/**
 * Get NPP payment status
 */
exports.getPaymentStatus = async (event) => {
  try {
    const userId = event.requestContext.authorizer.claims.sub;
    const paymentId = event.pathParameters.paymentId;
    
    // First check the local payment record
    const getPaymentResult = await ddbDocClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `USER#${userId}`,
          SK: `PAYMENT#NPP#${paymentId}`
        }
      })
    );
    
    // If payment not found, return error
    if (!getPaymentResult.Item) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': true
        },
        body: JSON.stringify({
          message: 'Payment not found'
        })
      };
    }
    
    const payment = getPaymentResult.Item;
    
    // If payment is already completed or failed, return the cached status
    if (payment.status === 'COMPLETED' || payment.status === 'FAILED') {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': true
        },
        body: JSON.stringify({
          paymentId,
          status: payment.status,
          nppReference: payment.nppReference,
          createdAt: payment.createdAt,
          updatedAt: payment.updatedAt
        })
      };
    }
    
    // Call NPP API to check payment status
    const response = await axios.get(
      `${NPP_API_URL}/payments/${payment.nppReference}`,
      {
        headers: {
          'x-api-key': NPP_API_KEY
        }
      }
    );
    
    // Update payment status in DynamoDB
    const updatedStatus = response.data.status || payment.status;
    const timestamp = new Date().toISOString();
    
    await ddbDocClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `USER#${userId}`,
          SK: `PAYMENT#NPP#${paymentId}`
        },
        UpdateExpression: 'SET #status = :status, #updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#updatedAt': 'updatedAt'
        },
        ExpressionAttributeValues: {
          ':status': updatedStatus,
          ':updatedAt': timestamp
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
        paymentId,
        status: updatedStatus,
        nppReference: payment.nppReference,
        createdAt: payment.createdAt,
        updatedAt: timestamp
      })
    };
  } catch (error) {
    console.error('Error checking NPP payment status:', error);
    
    return {
      statusCode: error.response?.status || 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true
      },
      body: JSON.stringify({
        message: 'Failed to check payment status',
        error: error.message
      })
    };
  }
};