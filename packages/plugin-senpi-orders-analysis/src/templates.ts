export const transferEthTemplate = `
Extract the following details to transfer ETH on Base:
- **amount** (Number): The amount of ETH on Base to transfer in wei.
- **toAddress** (String): The address to transfer the ETH to on Base. Can be either:
  - A valid Ethereum address following regex format: ^0x[a-fA-F0-9]{40}$
  - An ENS name in format: name.eth

Provide the values in the following JSON format:

\`\`\`json
{
    "amount": number,
    "toAddress": string,
    "isENS": boolean
}
\`\`\`

Here are example messages and their corresponding responses:

**Message 1**

\`\`\`
Send 0.01 ETH to 0x114B242D931B47D5cDcEe7AF065856f70ee278C4
\`\`\`

**Response 1**

\`\`\`json
{
    "amount": 0.01,
    "toAddress": "0x114B242D931B47D5cDcEe7AF065856f70ee278C4",
    "isENS": false
}
\`\`\`

**Message 2**

\`\`\`
Send 0.5 ETH to tokenstaker.eth
\`\`\`

**Response 2**

\`\`\`json
{
    "amount": 0.5,
    "toAddress": "tokenstaker.eth",
    "isENS": true
}
\`\`\`

Here are the recent user messages for context:
{{recentMessages}}
`;
