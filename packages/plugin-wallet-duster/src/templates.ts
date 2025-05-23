import { formatTokenMention } from "@moxie-protocol/moxie-agent-lib";
import { ethers } from "ethers";

export const dustRequestTemplate = `
Based on user's recent messages with the agent, provide the following details to dust tokens in your wallet:
- **threshold** (Number): The USD threshold for a token to be considered dust tokens.
- **isConfirmed** (Boolean): Whether the user has confirmed the dusting based on the user's recent messages.

Provide the values in the following JSON format:
\`\`\`json
{
    "threshold": number?,
    "isConfirmed": boolean?
}
\`\`\`
"?" indicates that the value is optional.

## General Rules
- For USD value threshold, use the exact USD value mentioned by the user in the recent messages. Otherwise, set it to null.
- If the user has asked to \`PREVIEW_DUSTING_MY_WALLET\` action first prior to dusting, then evaluate the value to be assigned to **isConfirmed**.
    - If the user has confirmed the dusting, set **isConfirmed** to true.
    - If the user has not confirmed the dusting, set **isConfirmed** to null.
    - If the user has rejected the dusting, set **isConfirmed** to false.
- If the user has asked to \`DUST_TOKENS\` action without previewing first, then set **isConfirmed** to true by default.
- For each of these values, please reset the value to null if the user has given a new request, which means the previous request is no longer valid.

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
            "action": "PREVIEW_DUSTING_MY_WALLET"
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
            "action": "DUST_TOKENS"
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
            "action": "PREVIEW_DUSTING_MY_WALLET"
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
            "action": "PREVIEW_DUSTING_MY_WALLET"
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
            "action": "DUST_TOKENS"
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
            "action": "PREVIEW_DUSTING_MY_WALLET"
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
            "action": "DUST_TOKENS"
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
            "action": "PREVIEW_DUSTING_MY_WALLET"
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
            "action": "DUST_TOKENS"
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
