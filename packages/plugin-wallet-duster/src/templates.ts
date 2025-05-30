import { formatTokenMention } from "@moxie-protocol/moxie-agent-lib";
import { ethers } from "ethers";

export const dustRequestTemplate = `
Based on the user's recent messages with the agent, extract the following details related to dusting tokens in the wallet:

- **threshold** (Number): The USD value below which tokens are considered dust.
- **isConfirmed** (Boolean): Whether the user has explicitly confirmed the dusting action.

Provide the result in the following JSON format:

\`\`\`json
{
  "threshold": number?,
  "isConfirmed": boolean?
}
\`\`\`
"?" indicates that the value is optional if it cannot be determined confidently.

# Extraction Logic
## threshold
- If the user says things like "dust tokens under $X" or "remove all tokens below $X", extract X as the threshold.
- If no threshold is mentioned, assign \`null\`.
## isConfirmed
1. Direct Dusting Requests (no preview involved)
- If the user says “Dust tokens under $X” or “Dust my tokens” without a prior PREVIEW_DUST_TOKENS action, set \`isConfirmed: true\`
2. Preview Flow
- If the last action is \`PREVIEW_DUST_TOKENS\`, only set \`isConfirmed: true\` if the user explicitly confirms afterward, such as:
    - "Yes", "Proceed", "Confirm", "Go ahead", "Dust them all"
- If the user says "No", "Cancel", or similar, set \`isConfirmed: false\`
- If no clear confirmation or rejection yet, set \`isConfirmed: null\`
3. Dusting Without Preview
- If the system has performed DUST_WALLET_TO_ETH without any preview beforehand, set \`isConfirmed: true\`
4. New Requests Overriding Previous Flow
- If the user starts a new dusting request (e.g., different threshold or a new “preview” command) after already confirming a previous one, then reset both threshold and isConfirmed to null

**Important Note**: \`isConfirmed\` should never be true immediately after a preview unless the user explicitly confirms. Intent to proceed must follow after the preview.

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
# Example 5 (Combination with preview action and extracting from historical messages)
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
    }
]
\`\`\`
**Response 5**
\`\`\`json
{
    "threshold": 15,
    "isConfirmed": true
}
\`\`\`
# Example 6 (Combination with preview action and extracting from historical messages + new request that invalidates the previous request)
**Message 6**
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
**Response 6**
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
    sellTokenAddress: string,
    buyTokenSymbol: string,
    buyTokenAddress: string,
    txHash: string
) => ({
    text: `\nDusting ${formatTokenMention(sellTokenSymbol, sellTokenAddress)} to ${formatTokenMention(buyTokenSymbol, buyTokenAddress)} is in progress.\nView transaction status on [BaseScan](https://basescan.org/tx/${txHash})`,
    content: {
        url: `https://basescan.org/tx/${txHash}`,
    },
});

export const swapCompletedTemplate = (
    sellTokenSymbol: string,
    sellTokenAddress: string,
    buyTokenSymbol: string,
    buyTokenAddress: string,
    buyAmountInWEI: bigint,
    buyTokenDecimals: number
) => ({
    text: `\nDusting ${formatTokenMention(sellTokenSymbol, sellTokenAddress)} to ${formatTokenMention(buyTokenSymbol, buyTokenAddress)} completed successfully. ${buyAmountInWEI && buyAmountInWEI > 0n ? `\n${ethers.formatUnits(buyAmountInWEI.toString(), buyTokenDecimals)} ${buyTokenSymbol} received.` : ""}\n`,
});
