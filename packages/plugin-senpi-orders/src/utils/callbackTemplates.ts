import { ethers } from "ethers";
import { formatTokenMention } from "@moxie-protocol/moxie-agent-lib";

export const insufficientEthBalanceTemplate = {
    text: `\nInsufficient ETH balance to complete this transaction. Please add more ETH to your wallet to cover gas fees.`,
};

export const swapOperationFailedTemplate = (error: Error) => ({
    text: `\nAn error occurred while performing the swap operation. Please try again.`,
    content: {
        error: "SWAP_OPERATION_FAILED",
        details: `An error occurred while performing the swap operation: ${error.message}.`,
    },
});

export const swapInProgressTemplate = (
    sellTokenSymbol: string,
    sellTokenAddress: string,
    buyTokenSymbol: string,
    buyTokenAddress: string,
    txHash: string
) => ({
    text: `\n${formatTokenMention(sellTokenSymbol, sellTokenAddress)} to ${formatTokenMention(buyTokenSymbol, buyTokenAddress)} conversion is in progress.\nView transaction status on [BaseScan](https://basescan.org/tx/${txHash})`,
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
    text: `\n${formatTokenMention(sellTokenSymbol, sellTokenAddress)} to ${formatTokenMention(buyTokenSymbol, buyTokenAddress)} conversion completed successfully. ${buyAmountInWEI && buyAmountInWEI > 0n ? `\n${ethers.formatUnits(buyAmountInWEI.toString(), buyTokenDecimals)} ${buyTokenSymbol} received.` : ""}`,
});

export const swapFailedTemplate = (
    sellTokenSymbol: string,
    sellTokenAddress: string,
    buyTokenSymbol: string,
    buyTokenAddress: string,
    error: Error
) => ({
    text: `\nFailed to swap ${formatTokenMention(sellTokenSymbol, sellTokenAddress)} to ${formatTokenMention(buyTokenSymbol, buyTokenAddress)} tokens. ${JSON.stringify(error)}`,
    content: {
        error: `${sellTokenSymbol}_TO_${buyTokenSymbol}_SWAP_FAILED`,
        details: `Failed to swap ${formatTokenMention(sellTokenSymbol, sellTokenAddress)} to ${formatTokenMention(buyTokenSymbol, buyTokenAddress)} tokens.`,
    },
});

export const insufficientBalanceTemplate = (
    sellTokenSymbol: string,
    sellTokenAddress: string,
    balance: bigint,
    requiredBalance: bigint,
    decimals: number
) => ({
    text: `\nInsufficient ${formatTokenMention(sellTokenSymbol, sellTokenAddress)} balance to complete this purchase.\nCurrent balance: ${ethers.formatUnits(balance.toString(), decimals)} ${formatTokenMention(sellTokenSymbol, sellTokenAddress)}\nRequired balance: ${ethers.formatUnits(requiredBalance.toString(), decimals)} ${formatTokenMention(sellTokenSymbol, sellTokenAddress)}\n\nPlease add more ${formatTokenMention(sellTokenSymbol, sellTokenAddress)} to your wallet to complete this purchase.`,
});

export const creatorCoinTransactionSubmittedTemplate = (
    swapTxnHash: string
) => ({
    text: `\nView transaction status on [BaseScan](https://basescan.org/tx/${swapTxnHash})`,
    content: {
        url: `https://basescan.org/tx/${swapTxnHash}`,
    },
});

export const transactionFailedTemplate = (error: Error) => ({
    text: `\nTransaction failed: ${error.message}. Please try again or contact support if the issue persists.`,
});

export const transactionConfirmedTemplate = (swapTxnHash: string) => ({
    text: `\nTransaction confirmed: View on BaseScan: https://basescan.org/tx/${swapTxnHash}.`,
    content: {
        url: `https://basescan.org/tx/${swapTxnHash}`,
    },
});

export const agentWalletNotFound = {
    text: `\nPlease make sure to set up your agent wallet first and try again.`,
};

export const delegateAccessNotFound = {
    text: `\nPlease make sure to set up your agent wallet first and try again.`,
};

export const approvalTransactionSubmitted = (approvalTxHash: string) => ({
    text: `\nApproval transaction submitted. Awaiting confirmation.\nView on [BaseScan](https://basescan.org/tx/${approvalTxHash})`,
    content: {
        url: `https://basescan.org/tx/${approvalTxHash}`,
    },
});

export const approvalTransactionConfirmed = (approvalTxHash: string) => ({
    text: `\nApproval transaction is confirmed!`,
    content: {
        url: `https://basescan.org/tx/${approvalTxHash}`,
    },
});

export const approvalTransactionFailed = (approvalTxHash: string) => ({
    text: `\nApproval transaction is failed!`,
});

export const senpiWalletClientNotFound = {
    text: `\nUnable to access Senpi wallet details. Please ensure your Senpi wallet is properly setup and try again.`,
};

export const approvalTransactionTimedOut = (approvalTxHash: string) => ({
    text: `\nApproval transaction timed out. Please check [BaseScan](https://basescan.org/tx/${approvalTxHash}) to verify the status before retrying.`,
    content: {
        url: `https://basescan.org/tx/${approvalTxHash}`,
    },
});

export const approvalTransactionSubmissionFailed = () => ({
    text: `\nApproval transaction submission failed. Please try again.`,
});

export const senpiInvalidOrderType = {
    text: `\nInvalid order type. Please review the order and try again.`,
};