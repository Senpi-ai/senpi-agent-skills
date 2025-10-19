export const earlyBirdsTemplate = `
Please provide between 1 and 4 Ethereum token addresses, each in the following format: $[tokenSymbol|0x...] or just 0x... for address only, for example: $[WETH|0x4200000000000000000000000000000000000006] or 0x4200000000000000000000000000000000000006

- The format is: $[tokenSymbol|tokenAddress] OR just tokenAddress
  - \`tokenSymbol\` is the symbol of the token (e.g., WETH, USDC, DAI) - OPTIONAL
  - \`tokenAddress\` is the Ethereum address (must match: ^0x[a-fA-F0-9]{40}$) - REQUIRED

Enter your tokens in the following JSON format:

\`\`\`json
{
  "token1": {
    "symbol": "WETH",
    "address": "0x4200000000000000000000000000000000000006"
  },
  "token2": {
    "symbol": "USDC",
    "address": "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
  },
  "token3": {
    "symbol": "DAI",
    "address": "0x0000000000000000000000000000000000000000"
  }, // optional
  "token4": {
    "symbol": "UNI",
    "address": "0x0000000000000000000000000000000000000000"
  }  // optional
}
\`\`\`

- If you leave any token empty, both \`symbol\` and \`address\` will default to: \`"symbol": "", "address": "0x0000000000000000000000000000000000000000"\`
- You **must** provide at least 1 and at most 4 tokens.
- If you provide fewer than 1 or more than 4 tokens, throw an error:  
  \`"Error: You must provide between 1 and 4 token addresses in the format $[tokenSymbol|tokenAddress] or just tokenAddress."\`

**Examples:**

**Example 1 (2 tokens with symbols):**
\`\`\`json
{
  "token1": {
    "symbol": "WETH",
    "address": "0x1234567890abcdef1234567890abcdef12345678"
  },
  "token2": {
    "symbol": "USDC",
    "address": "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"
  },
  "token3": {
    "symbol": "",
    "address": "0x0000000000000000000000000000000000000000"
  },
  "token4": {
    "symbol": "",
    "address": "0x0000000000000000000000000000000000000000"
  }
}
\`\`\`

**Example 2 (1 token without symbol - address only):**
\`\`\`json
{
  "token1": {
    "symbol": "",
    "address": "0x1234567890abcdef1234567890abcdef12345678"
  },
  "token2": {
    "symbol": "",
    "address": "0x0000000000000000000000000000000000000000"
  },
  "token3": {
    "symbol": "",
    "address": "0x0000000000000000000000000000000000000000"
  },
  "token4": {
    "symbol": "",
    "address": "0x0000000000000000000000000000000000000000"
  }
}
\`\`\`

**Example 3 (4 tokens):**
\`\`\`json
{
  "token1": {
    "symbol": "WETH",
    "address": "0x1111111111111111111111111111111111111111"
  },
  "token2": {
    "symbol": "USDC",
    "address": "0x2222222222222222222222222222222222222222"
  },
  "token3": {
    "symbol": "DAI",
    "address": "0x3333333333333333333333333333333333333333"
  },
  "token4": {
    "symbol": "UNI",
    "address": "0x4444444444444444444444444444444444444444"
  }
}
\`\`\`

If you provide fewer than 4 tokens, fill the remaining tokens with the default values.

---

Here are the recent user messages for context:
{{recentMessages}}
`
export const earlybirdWalletAddressesTemplate = `
For the response to the user you should return the following JSON format which are the addresses of the early buyers of the tokens which are valid ethereum addresses:
Mention that these are the early buyers of the tokens: and if empty, mention that no mutual early buyers were found.
\`\`\`json
{
  "buyers": {{buyers}}
}
\`\`\`

This is the format of the buyers:
\`\`\`json
{
  "buyers": ["0x...", "0x...", "0x...", "0x..."]
}
\`\`\`
`