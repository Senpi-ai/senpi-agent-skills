import { ethers } from "ethers";

export const dustRequestTemplate = `
Based on user's recent messages with the agent, provide the following details to dust tokens in your wallet:
- **threshold** (Number): The USD threshold for a token to be considered dust tokens.
- **isConfirmed** (Boolean): Whether the user has given any consent/confirmation to the dusting based on the user's recent messages.
Provide the values in the following JSON format:
\`\`\`json
{
    "threshold": number?,
    "isConfirmed": boolean?
}
\`\`\`
"?" indicates that the value is optional.
## General Rules
## Value Extraction Rules
- **threshold**:
  - Extract the dollar value if user says things like "dust tokens under $X".
  - If not specified, set to null.
- **isConfirmed**:
  - If the most recent action is "PREVIEW_DUST_TOKENS":
    - If user confirms afterward ("Yes", "Proceed", "Go ahead") → true
    - If user rejects ("No", "Cancel") → false
    - If no follow-up confirmation/rejection yet → null
  - If the most recent action is "DUST_WALLET_TO_ETH" without any previous preview request → true
  - If a new dusting request is issued (e.g., new threshold, or repeat command), reset both values to null.
Note: Always ensure that confirmation follows a preview. If a user previews but hasn’t yet responded, **isConfirmed** must stay null – even if the request looks positive.
Here are some examples of user's conversation with the agent and the expected response:
# Example 1
**Message 1**
\`\`\`
[
    {
        "user": "{{user1}}",
        "content": {
            "text": "Dust tokens under $1"
        }
    }
]
\`\`\`
**Response 1**
\`\`\`json
{
    "threshold": 1,
    "isConfirmed": true
}
\`\`\`
# Example 2
**Message 2**
\`\`\`
[
    {
        "user": "{{user1}}",
        "content": {
            "text": "Dust my tokens"
        }
    }
]
\`\`\`
**Response 2**
\`\`\`json
{
    "threshold": null,
    "isConfirmed": true
}
\`\`\`
# Example 3 (Combination with preview action)
**Message 3**
\`\`\`
[
    {
        "user": "{{user1}}",
        "content": {
            "text": "Preview dusting my wallet"
        }
    },
    {
        "user": "{{user2}}",
        "content": {
            "text": "You have 1 dust token(s) totaling ~ $0.08: 0x123... (1000 tokens worth $0.08)",
            "action": "PREVIEW_DUST_TOKENS"
        }
    },
    {
        "user": "{{user1}}",
        "content": {
            "text": "Great! can you dust them all?"
        }
    },
]
\`\`\`
**Response 3**
\`\`\`json
{
    "threshold": null,
    "isConfirmed": null
}
\`\`\`
# Example 4 (Combination with preview action)
**Message 4**
\`\`\`
[
    {
        "user": "{{user1}}",
        "content": {
            "text": "dust tokens under $1"
        }
    },
    {
        "user": "{{user2}}",
        "content": {
            "text": "Dusted 3 dust tokens into ETH.",
            "action": "DUST_WALLET_TO_ETH"
        }
    },
    {
        "user": "{{user1}}",
        "content": {
            "text": "Preview dusting my wallet"
        }
    },
    {
        "user": "{{user2}}",
        "content": {
            "text": "You have 1 dust token(s) totaling ~ $0.08: 0x123... (1000 tokens worth $0.08)",
            "action": "PREVIEW_DUST_TOKENS"
        }
    },
    {
        "user": "{{user1}}",
        "content": {
            "text": "Great! can you dust them all?"
        }
    },
]
\`\`\`
**Response 4**
\`\`\`json
{
    "threshold": null,
    "isConfirmed": null
}
\`\`\`
# Example 4 (Combination with preview action and extracting from historical messages)
**Message 4**
\`\`\`
[
    {
        "user": "{{user1}}",
        "content": {
            "text": "Preview dusting all tokens under $15"
        }
    },
    {
        "user": "{{user2}}",
        "content": {
            "text": "Here are the tokens under $15 in your wallet: 0x123... (1000 tokens worth $4.99)",
            "action": "PREVIEW_DUST_TOKENS"
        }
    },
    {
        "user": "{{user1}}",
        "content": {
            "text": "Great! can you dust them all?"
        }
    },
    {
        "user": "{{user2}}",
        "content": {
            "text": "You are trying to dust tokens under $15 from your agent wallet. Depending on the number of tokens, this may take a several minutes to complete. \n\nDo you want to proceed?",
            "action": "DUST_WALLET_TO_ETH"
        }
    },
    {
        "user": "{{user1}}",
        "content": {
            "text": "Yes, proceed"
        }
    }
]
\`\`\`
**Response 4**
\`\`\`json
{
    "threshold": 15,
    "isConfirmed": true
}
\`\`\`
# Example 5 (Combination with preview action and extracting from historical messages + new request that invalidates the previous request)
**Message 5**
\`\`\`
[
    {
        "user": "{{user1}}",
        "content": {
            "text": "Preview dusting all tokens under $15"
        }
    },
    {
        "user": "{{user2}}",
        "content": {
            "text": "Here are the tokens under $15 in your wallet: 0x123... (1000 tokens worth $4.99)",
            "action": "PREVIEW_DUST_TOKENS"
        }
    },
    {
        "user": "{{user1}}",
        "content": {
            "text": "Great! can you dust them all?"
        }
    },
    {
        "user": "{{user2}}",
        "content": {
            "text": "You are trying to dust tokens under $15 from your agent wallet. Depending on the number of tokens, this may take a several minutes to complete. \n\nDo you want to proceed?",
            "action": "DUST_WALLET_TO_ETH"
        }
    },
    {
        "user": "{{user1}}",
        "content": {
            "text": "Yes, proceed"
        }
    },
    {
        "user": "{{user1}}",
        "content": {
            "text": "Thanks, now can you show all dust tokens under $1"
        }
    },
    {
        "user": "{{user2}}",
        "content": {
            "text": "Here are the tokens under $1 in your wallet: 0x123... (1000 tokens worth $4.99)",
            "action": "PREVIEW_DUST_TOKENS"
        }
    },
    {
        "user": "{{user1}}",
        "content": {
            "text": "dust them all pls"
        }
    },
    {
        "user": "{{user2}}",
        "content": {
            "text": "You are trying to dust tokens under $1 from your agent wallet. Depending on the number of tokens, this may take a several minutes to complete. \n\nDo you want to proceed?",
            "action": "DUST_WALLET_TO_ETH"
        }
    },
]
\`\`\`
**Response 5**
\`\`\`json
{
    "threshold": 1,
    "isConfirmed": null
}
\`\`\`
Here are the recent user messages for context:
{{recentMessages}}
`;

export const swapInProgressTemplate = (
    sellTokenSymbol: string,
    buyTokenSymbol: string,
    txHash: string
) => ({
    text: `\nDusting $${sellTokenSymbol} to $${buyTokenSymbol} is in progress.\nView transaction status on [BaseScan](https://basescan.org/tx/${txHash})`,
    content: {
        url: `https://basescan.org/tx/${txHash}`,
    },
});

export const swapCompletedTemplate = (
    sellTokenSymbol: string,
    buyTokenSymbol: string,
    buyAmountInWEI: bigint,
    buyTokenDecimals: number
) => ({
    text: `\nDusting $${sellTokenSymbol} to $${buyTokenSymbol} completed successfully. ${buyAmountInWEI && buyAmountInWEI > 0n ? `\n${ethers.formatUnits(buyAmountInWEI.toString(), buyTokenDecimals)} ${buyTokenSymbol} received.` : ""}\n`,
});
