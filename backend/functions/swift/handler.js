const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient();
const ddbDocClient = DynamoDBDocumentClient.from(client);

// SWIFT API configuration
const SWIFT_API_URL = process.env.SWIFT_API_URL;
const SWIFT_API_KEY = process.env.SWIFT_API_KEY;
const TABLE_NAME = process.env.FINANCIAL_DATA_TABLE || 'financial-data-dev';

/**
 * Create ISO 20022 compliant message for SWIFT transfer
 * This is a simplified version - in production, you would use a proper ISO 20022 library
 */
const createISO20022Message = (sourceAccount, destinationAccount, amount, currency, description, reference, messageId) => {
  const timestamp = new Date().toISOString().replace(/[-:.]/g, '');
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>${messageId}</MsgId>
      <CreDtTm>${timestamp}</CreDtTm>
      <NbOfTxs>1</NbOfTxs>
      <CtrlSum>${amount}</CtrlSum>
      <InitgPty>
        <Nm>Sender Name</Nm>
      </InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>${messageId}-1</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <ReqdExctnDt>${new Date().toISOString().split('T')[0]}</ReqdExctnDt>
      <Dbtr>
        <Nm>Sender Name</Nm>
      </Dbtr>
      <DbtrAcct>
        <Id>
          <Othr>
            <Id>${sourceAccount}</Id>
          </Othr>
        </Id>
      </DbtrAcct>
      <CdtTrfTxInf>
        <PmtId>
          <EndToEndId>${reference || messageId}</EndToEndId>
        </PmtId>
        <Amt>
          <InstdAmt Ccy="${currency}">${amount}</InstdAmt>
        </Amt>
        <Cdtr>
          <Nm>${destinationAccount.accountName}</Nm>
        </Cdtr>
        <CdtrAcct>
          <Id>
            <Othr>
              <Id>${destinationAccount.accountNumber}</Id>
            </Othr>
          </Id>
        </CdtrAcct>
        <RmtInf>
          <Ustrd>${description}</Ustrd>
        </RmtInf>
      </CdtTrfTxInf>
    </PmtInf>
  </CstmrCdtTrfInitn>
</Document>`;
};

/**
 * Initiate a SWIFT transfer
 */
exports.initiateTransfer = async (event) => {
  try {
    const userId = event.requestContext.authorizer.claims.sub;
    const transferDetails = JSON.parse(event.body);
    
    // Validate required fields
    if (!transferDetails.sourceAccount) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': true
        },
        body: JSON.stringify({
          message: 'Source account is required'
        })
      };
    }
    
    if (!transferDetails.destinationAccount || 
        !transferDetails.destinationAccount.accountName || 
        !transferDetails.destinationAccount.accountNumber || 
        !transferDetails.destinationAccount.swiftCode || 
        !transferDetails.destinationAccount.bankName || 
        !transferDetails.destinationAccount.bankAddress) {
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
    
    if (!transferDetails.amount || isNaN(parseFloat(transferDetails.amount)) || parseFloat(transferDetails.amount) <= 0) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': true
        },
        body: JSON.stringify({
          message: 'Valid transfer amount is required'
        })
      };
    }

    // Generate a unique transfer ID
    const transferId = uuidv4();
    const messageId = uuidv4();
    
    // Create ISO 20022 compliant message
    const iso20022Message = createISO20022Message(
      transferDetails.sourceAccount,
      transferDetails.destinationAccount,
      transferDetails.amount,
      transferDetails.currency || 'USD',
      transferDetails.description || '',
      transferDetails.reference || '',
      messageId
    );
    
    // Call SWIFT API to initiate transfer
    const response = await axios.post(
      `${SWIFT_API_URL}/transfers`,
      {
        messageId,
        messageType: 'pain.001.001.09',
        messageContent: iso20022Message,
        sourceAccount: transferDetails.sourceAccount,
        destinationAccount: {
          name: transferDetails.destinationAccount.accountName,
          number: transferDetails.destinationAccount.accountNumber,
          swiftCode: transferDetails.destinationAccount.swiftCode,
          bank: {
            name: transferDetails.destinationAccount.bankName,
            address: transferDetails.destinationAccount.bankAddress
          }
        },
        amount: parseFloat(transferDetails.amount).toFixed(2),
        currency: transferDetails.currency || 'USD',
        description: transferDetails.description || '',
        reference: transferDetails.reference || ''
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': SWIFT_API_KEY
        }
      }
    );
    
    // Store transfer data in DynamoDB
    const timestamp = new Date().toISOString();
    await ddbDocClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `USER#${userId}`,
          SK: `TRANSFER#SWIFT#${transferId}`,
          transferId,
          messageId,
          sourceAccount: transferDetails.sourceAccount,
          destinationAccount: transferDetails.destinationAccount,
          amount: transferDetails.amount,
          currency: transferDetails.currency || 'USD',
          description: transferDetails.description,
          reference: transferDetails.reference,
          status: response.data.status || 'PROCESSING',
          swiftReference: response.data.swiftReference || messageId,
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
        transferId,
        status: response.data.status || 'PROCESSING',
        swiftReference: response.data.swiftReference || messageId,
        createdAt: timestamp
      })
    };
  } catch (error) {
    console.error('Error initiating SWIFT transfer:', error);
    
    return {
      statusCode: error.response?.status || 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true
      },
      body: JSON.stringify({
        message: 'Failed to initiate SWIFT transfer',
        error: error.message
      })
    };
  }
};

/**
 * Get SWIFT transfer status
 */
exports.getTransferStatus = async (event) => {
  try {
    const userId = event.requestContext.authorizer.claims.sub;
    const transferId = event.pathParameters.transferId;
    
    // First check the local transfer record
    const getTransferResult = await ddbDocClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `USER#${userId}`,
          SK: `TRANSFER#SWIFT#${transferId}`
        }
      })
    );
    
    // If transfer not found, return error
    if (!getTransferResult.Item) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': true
        },
        body: JSON.stringify({
          message: 'Transfer not found'
        })
      };
    }
    
    const transfer = getTransferResult.Item;
    
    // If transfer is already completed or failed, return the cached status
    if (transfer.status === 'COMPLETED' || transfer.status === 'FAILED') {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': true
        },
        body: JSON.stringify({
          transferId,
          status: transfer.status,
          swiftReference: transfer.swiftReference,
          createdAt: transfer.createdAt,
          updatedAt: transfer.updatedAt
        })
      };
    }
    
    // Call SWIFT API to check transfer status
    const response = await axios.get(
      `${SWIFT_API_URL}/transfers/${transfer.swiftReference}`,
      {
        headers: {
          'x-api-key': SWIFT_API_KEY
        }
      }
    );
    
    // Update transfer status in DynamoDB
    const updatedStatus = response.data.status || transfer.status;
    const timestamp = new Date().toISOString();
    
    await ddbDocClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `USER#${userId}`,
          SK: `TRANSFER#SWIFT#${transferId}`
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
        transferId,
        status: updatedStatus,
        swiftReference: transfer.swiftReference,
        createdAt: transfer.createdAt,
        updatedAt: timestamp
      })
    };
  } catch (error) {
    console.error('Error checking SWIFT transfer status:', error);
    
    return {
      statusCode: error.response?.status || 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true
      },
      body: JSON.stringify({
        message: 'Failed to check transfer status',
        error: error.message
      })
    };
  }
};