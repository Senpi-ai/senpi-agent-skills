import { formatTokenMention } from "@moxie-protocol/moxie-agent-lib";

export const INVALID_TRANSACTION_STRUCTURE = (reason: string) => {
    return {
        text: "\nInvalid transaction structure. Please try again with a valid transaction request.",
        content: {
            error: "INVALID_CONTENT",
            details: reason,
            action: "TOKEN_TRANSFER",
        },
    };
};

export const APPLICATION_ERROR = (error: string) => {
    return {
        text: "\nAn error occurred while processing the transaction. Please try again.",
        content: {
            error: "APPLICATION_ERROR",
            details: error,
            action: "TOKEN_TRANSFER",
        },
    };
};

export const APPLICATION_ERROR_WITH_ERR_MESSAGE = (error: string) => {
    return {
        text: error,
        content: {
            action: "TOKEN_TRANSFER",
        },
        cta: "FUND_WALLET",
    };
}

export const CREATOR_NOT_FOUND = (creatorId: string) => {
    return {
        text: `\nUnfortunately, the user you are querying has not launched a creator coin yet. Creator coins are required to analyze user data using the Senpi AI Agent. Please try again`,
    };
};

export const INSUFFICIENT_BALANCE = (
    tokenSymbol: string,
    tokenAddress: string,
    currentBalance: string,
    requiredBalance: string
) => {
    return {
        text: `\nInsufficient balance in your agent wallet to complete this transaction. \nCurrent balance: ${currentBalance} ${formatTokenMention(tokenSymbol, tokenAddress)}\nRequired balance: ${requiredBalance} ${formatTokenMention(tokenSymbol, tokenAddress)}. Please add more funds to your agent wallet and try again.`,
    };
};

export const TRANSACTION_SUCCESSFUL = (
    txnHash: string,
    transferAmount: string,
    tokenSymbol: string,
    tokenAddress: string,
    recipient: string
) => {
    return {
        text: `\nTransaction Complete! Successfully sent ${transferAmount} ${formatTokenMention(tokenSymbol, tokenAddress)} to ${recipient}.\nView on [BaseScan](https://basescan.org/tx/${txnHash})`,
        content: {
            action: "TOKEN_TRANSFERS",
        },
    };
};

export const TRANSACTION_FAILED = (txnHash: string, error: string) => {
    return {
        text: `\nTransaction verification failed. Please try again.`,
        content: {
            action: "TOKEN_TRANSFERS",
        },
    };
};
export const TRANSACTION_VERIFICATION_TIMEOUT = (txnHash: string) => {
    return {
        text: `\nTransaction verification timed out. Please check [BaseScan](https://basescan.org/tx/${txnHash}) to verify the status before retrying.`,
        content: {
            action: "TOKEN_TRANSFERS",
        },
    };
};

export const TRANSACTION_SUBMISSION_FAILED = (reason?: string) => {
    return {
        text: reason
            ? `\nTransaction submission failed. Reason: ${reason}. Please try again.`
            : `\nTransaction submission failed. Please try again.`,
        content: {
            action: "TOKEN_TRANSFERS",
        },
    };
};
