import { ethers } from "ethers";
import { formatTokenMention } from "@moxie-protocol/moxie-agent-lib";

export const insufficientEthBalanceTemplate = {
    text: `\nInsufficient ETH balance to complete this transaction. Please add more ETH to your wallet to cover gas fees.`,
};

export const swapOperationFailedTemplate = (error: Error) => ({
    text: `\n⚠️ That wasn't supposed to happen. Hit retry and let's pretend it didn't. \n`,
    content: {
        error: "SWAP_OPERATION_FAILED",
        details: `An error occurred while performing the swap operation: ${error.message}.`,
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

export const agentWalletNotFound = {
    text: `\nPlease make sure to set up your agent wallet first and try again.`,
};

export const delegateAccessNotFound = {
    text: `\nPlease make sure to set up your agent wallet first and try again.`,
};

export const senpiWalletClientNotFound = {
    text: `\nUnable to access Senpi wallet details. Please ensure your Senpi wallet is properly setup and try again.`,
};

export const senpiInvalidOrderType = {
    text: `\nInvalid order type. Please review the order and try again.`,
};