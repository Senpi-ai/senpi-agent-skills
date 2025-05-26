import { ethers } from "ethers";
import {
    ETH_ADDRESS,
    MOXIE_TOKEN_ADDRESS,
    MOXIE_TOKEN_DECIMALS,
} from "../constants";
import { formatTokenMention } from "@moxie-protocol/moxie-agent-lib";

export const insufficientEthBalanceTemplate = {
    text: `\nInsufficient ${formatTokenMention("ETH", ETH_ADDRESS)} balance to complete this transaction. Please add more ${formatTokenMention("ETH", ETH_ADDRESS)} to your wallet to cover gas fees.`,
};

export const swapOperationFailedTemplate = (error: Error) => ({
    text: `\nAn error occurred while performing the swap operation. Please try again.`,
    content: {
        error: "SWAP_OPERATION_FAILED",
        details: `An error occurred while performing the swap operation: ${error.message}.`,
    },
});

export const insufficientMoxieBalanceTemplate = (
    currentBalance: bigint,
    requiredAmount: bigint
) => ({
    text: `\nInsufficient ${formatTokenMention("MOXIE", MOXIE_TOKEN_ADDRESS)} balance to complete this purchase.\nCurrent ${formatTokenMention("MOXIE", MOXIE_TOKEN_ADDRESS)}: ${ethers.utils.formatEther(currentBalance)} ${formatTokenMention("MOXIE", MOXIE_TOKEN_ADDRESS)}\nRequired ${formatTokenMention("MOXIE", MOXIE_TOKEN_ADDRESS)}: ${ethers.utils.formatEther(requiredAmount)} ${formatTokenMention("MOXIE", MOXIE_TOKEN_ADDRESS)}\n\nPlease specify if you would like to proceed with other token?`,
});

export const initiatePurchaseTemplate = (
    buyTokenCreatorUsername: string,
    moxieInWEI: bigint
) => ({
    text: `\nInitiating purchase of ${buyTokenCreatorUsername} creator coins for ${ethers.utils.formatUnits(moxieInWEI.toString(), MOXIE_TOKEN_DECIMALS)} ${formatTokenMention("MOXIE", MOXIE_TOKEN_ADDRESS)}.`,
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
    text: `\n[${formatTokenMention(sellTokenSymbol, sellTokenAddress)} to ${formatTokenMention(buyTokenSymbol, buyTokenAddress)} conversion completed successfully. ${buyAmountInWEI && buyAmountInWEI > 0n ? `\n${ethers.utils.formatUnits(buyAmountInWEI.toString(), buyTokenDecimals)} ${formatTokenMention(buyTokenSymbol, buyTokenAddress)} received.` : ""}`,
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
    text: `\nInsufficient ${formatTokenMention(sellTokenSymbol, sellTokenAddress)} balance to complete this purchase.\nCurrent balance: ${ethers.utils.formatUnits(balance.toString(), decimals)} ${formatTokenMention(sellTokenSymbol, sellTokenAddress)}\nRequired balance: ${ethers.utils.formatUnits(requiredBalance.toString(), decimals)} ${formatTokenMention(sellTokenSymbol, sellTokenAddress)}\n\nPlease add more ${formatTokenMention(sellTokenSymbol, sellTokenAddress)} to your wallet to complete this purchase.`,
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

export const moxieWalletClientNotFound = {
    text: `\nUnable to access moxie wallet details. Please ensure your moxie wallet is properly setup and try again.`,
};

export const approvalTransactionTimedOut = (approvalTxHash: string) => ({
    text: `\nApproval transaction timed out. Please try again.`,
    content: {
        url: `https://basescan.org/tx/${approvalTxHash}`,
    },
});

export const swapTransactionVerificationTimedOut = (swapTxnHash: string) => ({
    text: `\nSwap transaction verification timed out. Please try again.`,
    content: {
        url: `https://basescan.org/tx/${swapTxnHash}`,
    },
});

export const swapTransactionFailed = (swapTxnHash: string) => ({
    text: `\nSwap transaction failed. Please try again.`,
    content: {
        url: `https://basescan.org/tx/${swapTxnHash}`,
    },
});
