# Australian Financial APIs Integration Demo

This project demonstrates integration with various Australian financial APIs using AWS Lambda, NextJS, and AWS Step Functions.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Features](#features)
- [APIs Integrated](#apis-integrated)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running Locally](#running-locally)
- [Deployment](#deployment)
- [Testing](#testing)
- [Project Structure](#project-structure)

## Architecture Overview

The application follows a serverless architecture pattern leveraging AWS services:

1. **Frontend**: NextJS application providing user interface
2. **API Gateway**: Routes HTTP requests to appropriate Lambda functions
3. **Lambda Functions**: Process requests and interact with various financial APIs
4. **Step Functions**: Orchestrate complex workflows like payment processing and account opening
5. **DynamoDB**: Store and retrieve financial data
6. **S3**: Store larger documents like bank statements

![Architecture Diagram](./docs/architecture-diagram.png)

## Features

- View and manage bank accounts using CDR (Consumer Data Right)
- Make instant payments using NPP (New Payments Platform)
- Validate BSB numbers and bank account details
- Connect to multiple financial data aggregation services (Yodlee, Basiq)
- Retrieve bank statements through Illion BankStatements API
- Process international payments using SWIFT
- Multi-step workflows for account opening and payment processing

## APIs Integrated

| API | Purpose | Endpoints |
|-----|---------|-----------|
| Consumer Data Right (CDR) | Access account and transaction data | `/cdr/accounts`, `/cdr/accounts/{id}/transactions` |
| New Payments Platform (NPP) | Process instant payments | `/npp/payments`, `/npp/payments/{id}` |
| BSB Lookup | Validate Australian bank details | `/bsb/{code}` |
| Yodlee | Financial data aggregation | `/yodlee/connect`, `/yodlee/accounts` |
| Illion BankStatements | Retrieve bank statements | `/illion/bankstatements`, `/illion/bankstatements/{id}` |
| Basiq | Open banking platform | `/basiq/connect`, `/basiq/accounts/{id}/transactions` |
| SWIFT | International transfers | `/swift/transfers`, `/swift/transfers/{id}` |

## Prerequisites

- Node.js 18.x or later
- AWS CLI configured with appropriate access
- AWS SAM CLI (for local testing)
- Serverless Framework
- NextJS 14 or later
- API credentials for each financial service

## Installation

1. Clone the repository:
   ```
   git clone https://github.com/yourusername/australian-financial-api-demo.git
   cd australian-financial-api-demo
   ```

2. Install backend dependencies:
   ```
   cd backend
   npm install
   ```

3. Install frontend dependencies:
   ```
   cd ../frontend
   npm install
   ```

## Configuration

### Environment Variables

Create a `.env` file in the `backend` directory with the following variables:

```
# AWS Configuration
STAGE=dev
REGION=ap-southeast-2

# CDR API
CDR_API_URL=https://api.cdr.example.com
CDR_CLIENT_ID=your_cdr_client_id
CDR_CLIENT_SECRET=your_cdr_client_secret

# NPP API
NPP_API_URL=https://api.npp.example.com
NPP_API_KEY=your_npp_api_key

# BSB Lookup API
BSB_LOOKUP_API_URL=https://api.bsb.example.com
BSB_LOOKUP_API_KEY=your_bsb_api_key

# Yodlee API
YODLEE_API_URL=https://api.yodlee.com
YODLEE_CLIENT_ID=your_yodlee_client_id
YODLEE_CLIENT_SECRET=your_yodlee_client_secret

# Illion BankStatements API
ILLION_API_URL=https://api.illion.com.au
ILLION_API_KEY=your_illion_api_key

# Basiq API
BASIQ_API_URL=https://au-api.basiq.io
BASIQ_API_KEY=your_basiq_api_key

# SWIFT API
SWIFT_API_URL=https://api.swift.com
SWIFT_API_KEY=your_swift_api_key
```

Create a `.env.local` file in the `frontend` directory:

```
NEXT_PUBLIC_API_URL=http://localhost:3000/api
```

### API Credentials

You'll need to register and obtain API credentials from each provider:

1. **CDR**: Register as an Accredited Data Recipient through the ACCC
2. **NPP**: Contact your bank or payment service provider for API access
3. **BSB Lookup**: Register with Australian Payments Network or use a third-party service
4. **Yodlee**: Register for a developer account at developer.yodlee.com
5. **Illion**: Apply for API access at illion.com.au
6. **Basiq**: Register at dashboard.basiq.io
7. **SWIFT**: Contact your bank for SWIFT API access

## Running Locally

### Backend

1. Start the Serverless Offline service:
   ```
   cd backend
   npm run start:dev
   ```

   This will start the API at `http://localhost:3000`

### Frontend

1. Start the NextJS development server:
   ```
   cd frontend
   npm run dev
   ```

   This will start the frontend at `http://localhost:3001`

## Deployment

### Backend Deployment

Deploy to AWS using Serverless Framework:

```
cd backend
npm run deploy
```

Optional: Specify stage with `--stage production`

### Frontend Deployment

1. Build the NextJS application:
   ```
   cd frontend
   npm run build
   ```

2. Deploy to your preferred hosting service (Vercel, AWS Amplify, etc.)

   For Vercel:
   ```
   vercel --prod
   ```

   For AWS Amplify:
   ```
   amplify publish
   ```

## Testing

### Unit Tests

```
cd backend
npm test
```

### Integration Tests

```
cd backend
npm run test:integration
```

### End-to-End Tests

```
cd frontend
npm run test:e2e
```

## Project Structure

```
australian-financial-api-demo/
├── frontend/                     # NextJS Frontend
│   ├── public/
│   ├── src/
│   │   ├── app/                  # App Router
│   │   ├── components/           # React components
│   │   ├── hooks/                # Custom React hooks
│   │   ├── services/             # API clients
│   │   └── utils/                # Utility functions
│   ├── package.json
│   └── next.config.js
├── backend/
│   ├── serverless.yml           # Serverless framework config
│   ├── common/                  # Shared code
│   ├── functions/               # Lambda functions
│   │   ├── auth/                # Authentication
│   │   ├── cdr/                 # CDR API integration
│   │   ├── npp/                 # NPP integration
│   │   ├── bsb/                 # BSB lookup
│   │   ├── yodlee/              # Yodlee integration
│   │   ├── illion/              # Illion integration
│   │   ├── basiq/               # Basiq integration
│   │   └── swift/               # SWIFT integration
│   └── step-functions/          # AWS Step Functions
│       ├── account-opening/     # Account opening workflow
│       ├── payment-processing/  # Payment processing workflow
│       ├── data-aggregation/    # Data aggregation workflow
│       └── loan-application/    # Loan application workflow
└── infrastructure/              # IaC with AWS CDK
    ├── lib/
    └── bin/
```

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Acknowledgments

- Australian Payments Network
- Consumer Data Standards Australia
- New Payments Platform Australia
- All the API providers for their documentation and services