const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient();
const ddbDocClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.FINANCIAL_DATA_TABLE || 'financial-data-dev';
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'; // Should be stored in AWS Secrets Manager in production
const JWT_EXPIRY = process.env.JWT_EXPIRY || '1d';

/**
 * Authenticate a user
 */
exports.authenticate = async (event) => {
  try {
    const { email, password } = JSON.parse(event.body);
    
    // Validate input
    if (!email || !password) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': true
        },
        body: JSON.stringify({
          message: 'Email and password are required'
        })
      };
    }
    
    // Query the user
    const queryResult = await ddbDocClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'EmailIndex',
        KeyConditionExpression: 'email = :email',
        ExpressionAttributeValues: {
          ':email': email.toLowerCase()
        }
      })
    );
    
    if (!queryResult.Items || queryResult.Items.length === 0) {
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': true
        },
        body: JSON.stringify({
          message: 'Invalid email or password'
        })
      };
    }
    
    const user = queryResult.Items[0];
    
    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    
    if (!isPasswordValid) {
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': true
        },
        body: JSON.stringify({
          message: 'Invalid email or password'
        })
      };
    }
    
    // Generate JWT token
    const token = jwt.sign(
      { 
        sub: user.userId, 
        email: user.email,
        name: user.name,
        iat: Math.floor(Date.now() / 1000)
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRY }
    );
    
    // Update last login time
    await ddbDocClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `USER#${user.userId}`,
          SK: 'PROFILE'
        },
        UpdateExpression: 'SET lastLogin = :lastLogin',
        ExpressionAttributeValues: {
          ':lastLogin': new Date().toISOString()
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
        token,
        user: {
          userId: user.userId,
          email: user.email,
          name: user.name
        }
      })
    };
  } catch (error) {
    console.error('Authentication error:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true
      },
      body: JSON.stringify({
        message: 'Authentication failed',
        error: error.message
      })
    };
  }
};

/**
 * Register a new user
 */
exports.register = async (event) => {
  try {
    const { name, email, password } = JSON.parse(event.body);
    
    // Validate input
    if (!name || !email || !password) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': true
        },
        body: JSON.stringify({
          message: 'Name, email, and password are required'
        })
      };
    }
    
    // Check if user already exists
    const queryResult = await ddbDocClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'EmailIndex',
        KeyConditionExpression: 'email = :email',
        ExpressionAttributeValues: {
          ':email': email.toLowerCase()
        }
      })
    );
    
    if (queryResult.Items && queryResult.Items.length > 0) {
      return {
        statusCode: 409,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': true
        },
        body: JSON.stringify({
          message: 'User with this email already exists'
        })
      };
    }
    
    // Hash password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);
    
    // Generate user ID
    const userId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    const timestamp = new Date().toISOString();
    
    // Store user in DynamoDB
    await ddbDocClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `USER#${userId}`,
          SK: 'PROFILE',
          userId,
          email: email.toLowerCase(),
          name,
          passwordHash,
          createdAt: timestamp,
          updatedAt: timestamp
        }
      })
    );
    
    // Generate JWT token
    const token = jwt.sign(
      { 
        sub: userId, 
        email: email.toLowerCase(),
        name,
        iat: Math.floor(Date.now() / 1000)
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRY }
    );
    
    return {
      statusCode: 201,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true
      },
      body: JSON.stringify({
        token,
        user: {
          userId,
          email: email.toLowerCase(),
          name
        }
      })
    };
  } catch (error) {
    console.error('Registration error:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true
      },
      body: JSON.stringify({
        message: 'Registration failed',
        error: error.message
      })
    };
  }
};

/**
 * Validate JWT token (used as an authorizer)
 */
exports.authorize = async (event) => {
  try {
    const authHeader = event.authorizationToken;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new Error('Unauthorized');
    }
    
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    
    return {
      principalId: decoded.sub,
      policyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Action: 'execute-api:Invoke',
            Effect: 'Allow',
            Resource: event.methodArn
          }
        ]
      },
      context: {
        userId: decoded.sub,
        email: decoded.email,
        name: decoded.name
      }
    };
  } catch (error) {
    console.error('Authorization error:', error);
    throw new Error('Unauthorized');
  }
};