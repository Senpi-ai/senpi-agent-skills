import { elizaLogger } from "@moxie-protocol/core";
import {
    getTokenDetails,
    formatTokenMention,
    MoxieHex,
    MoxieWalletClient,
    MoxieWalletSendTransactionInputType,
    MoxieWalletSendTransactionResponseType,
    MoxieWalletSignTypedDataResponseType,
} from "@moxie-protocol/moxie-agent-lib";
import { concat, ethers } from "ethers";
import { encodeFunctionData, numberToHex, size } from "viem";
import { GetQuoteResponse } from "../types";
import { swapCompletedTemplate, swapInProgressTemplate } from "../templates";
import Decimal from "decimal.js";
import { ERC20_ABI } from "../constants/constants";
import { createClientV2 } from "@0x/swap-ts-sdk";
import {
    BASE_NETWORK_ID,
    ETH_ADDRESS,
    MAX_UINT256,
    mockGetQuoteResponse,
    TRANSACTION_RECEIPT_TIMEOUT,
    WETH_ADDRESS,
    INITIAL_SLIPPAGE_IN_BPS,
    SLIPPAGE_INCREMENT_PER_RETRY_IN_BPS,
    SWAP_RETRY_COUNT,
    SWAP_RETRY_DELAY,
} from "../constants/constants";
import { getERC20Balance } from "./erc20";

const initializeClients = () => {
    if (!process.env.ZERO_EX_API_KEY) {
        elizaLogger.error(
            "ZERO_EX_API_KEY environment variable is not given, will use mock data"
        );
        return { zxClient: null };
    }

    try {
        const zxClient = createClientV2({
            apiKey: process.env.ZERO_EX_API_KEY,
        });
        return { zxClient };
    } catch (error) {
        elizaLogger.error(`Failed to initialize clients: ${error}`);
        throw new Error("Failed to initialize clients");
    }
};

const { zxClient } = initializeClients();

/**
 * Swaps tokens using 0x protocol
 * @param sellTokenAddress The address of the token to sell
 * @param sellTokenSymbol The symbol of the token to sell
 * @param moxieUserId The user ID of the person performing the swap
 * @param agentWalletAddress The wallet address of the person performing the swap
 * @param provider The ethers JsonRpcProvider instance
 * @param callback Optional callback function to receive status updates
 */
export async function swap(
    traceId: string,
    sellTokenAddress: string,
    sellTokenSymbol: string,
    moxieUserId: string,
    agentWalletAddress: string,
    provider: ethers.JsonRpcProvider,
    callback: any,
    walletClient: MoxieWalletClient
): Promise<bigint> {
    // Set buy token to ETH
    const buyTokenDecimals = 18;
    const buyTokenSymbol = "ETH";
    const buyTokenAddress = ETH_ADDRESS;
    await callback?.({
        text: `\n# Dusting ${formatTokenMention(sellTokenSymbol, sellTokenAddress)} to ${formatTokenMention(buyTokenSymbol, buyTokenAddress)}\n`,
    });
    elizaLogger.debug(
        traceId,
        `[tokenSwap] [${moxieUserId}] [swap] called, buyTokenAddress: ${buyTokenAddress}, buyTokenSymbol: ${buyTokenSymbol}, sellTokenAddress: ${sellTokenAddress}, sellTokenSymbol: ${sellTokenSymbol}, agentWalletAddress: ${agentWalletAddress}`
    );
    let buyAmountInWEI: bigint;
    let tokenBalance: bigint;
    let quote: GetQuoteResponse | null = null;

    try {
        // do balance check first
        const balance = await getERC20Balance(
            traceId,
            sellTokenAddress,
            agentWalletAddress
        );
        elizaLogger.debug(
            traceId,
            `[tokenSwap] [${moxieUserId}] [swap] balance: ${balance}`
        );
        tokenBalance = balance ? BigInt(balance) : BigInt(0);

        if (tokenBalance === BigInt(0)) {
            await callback?.({
                text: `\nNo ${formatTokenMention(sellTokenSymbol, sellTokenAddress)} found in your wallet.`,
            });
            return tokenBalance;
        }

        // call 0x api to get quote
        quote = await get0xSwapQuote({
            traceId: traceId,
            moxieUserId: moxieUserId,
            sellAmountBaseUnits: tokenBalance.toString(),
            buyTokenAddress: buyTokenAddress,
            buyTokenSymbol: buyTokenSymbol,
            walletAddress: agentWalletAddress,
            sellTokenAddress: sellTokenAddress,
            sellTokenSymbol: sellTokenSymbol,
        });
        elizaLogger.debug(
            traceId,
            `[tokenSwap] [${moxieUserId}] [swap] get0xSwapQuote: ${JSON.stringify(quote)}`
        );

        // check is liquidity is available
        if (!quote.liquidityAvailable) {
            elizaLogger.error(
                traceId,
                `[tokenSwap] [${moxieUserId}] [swap] liquidity not available for $${sellTokenSymbol} to $${buyTokenSymbol} swap`
            );
            const burnHash = await burnToken(
                traceId,
                moxieUserId,
                sellTokenAddress,
                tokenBalance.toString(),
                agentWalletAddress,
                walletClient
            );
            elizaLogger.debug(
                traceId,
                `[tokenSwap] [${moxieUserId}] [swap] burnHash: ${burnHash}`
            );
            await callback?.({
                text: `\nInsufficient liquidity to complete this transaction. Burning ${formatTokenMention(sellTokenSymbol, sellTokenAddress)} is in progress. View transaction status on [BaseScan](https://basescan.org/tx/${burnHash})`,
                content: {
                    url: `https://basescan.org/tx/${burnHash}`,
                },
            });

            const txnReceipt = await handleTransactionStatus(
                traceId,
                moxieUserId,
                provider,
                burnHash
            );

            if (txnReceipt.status == 1) {
                await callback?.({
                    text: `\nBurned ${formatTokenMention(sellTokenSymbol, sellTokenAddress)} successfully.`,
                });
            } else {
                await callback?.({
                    text: `\nBurned ${formatTokenMention(sellTokenSymbol, sellTokenAddress)} failed. Please try again.`,
                });
            }

            return buyAmountInWEI;
        }
        // for other currencies we need to check allowance and approve spending
        // check allowance and approve spending
        const issues = quote.issues;
        elizaLogger.debug(
            traceId,
            `[tokenSwap] [${moxieUserId}] [swap] issues from get0xSwapQuote: ${JSON.stringify(issues)}`
        );
        // check allowance and approve spending
        if (issues?.allowance && issues?.allowance != null) {
            await checkAllowanceAndApproveSpendRequest(
                traceId,
                moxieUserId,
                agentWalletAddress,
                sellTokenAddress,
                // @ts-expect-error - allowance.spender is not properly typed in the 0x API response
                issues.allowance.spender,
                tokenBalance,
                provider,
                walletClient
            );
            elizaLogger.debug(
                traceId,
                `[tokenSwap] [${moxieUserId}] [swap] checkAllowanceAndApproveSpendRequest completed`
            );
        }
        // check balance and approve spending
        if (issues?.balance && issues?.balance != null) {
            const balance = await getERC20Balance(
                traceId,
                sellTokenAddress,
                agentWalletAddress
            );
            elizaLogger.debug(
                traceId,
                `[tokenSwap] [${moxieUserId}] [swap] tokenBalance: ${balance}`
            );
            if (balance) {
                tokenBalance = BigInt(balance);
            }
        }
    } catch (error) {
        elizaLogger.error(
            traceId,
            `[tokenSwap] [${moxieUserId}] [swap] Error getting 0x quote: ${error.message}`
        );

        // Check for specific error in multiple possible locations
        const errorData =
            error.data ||
            (error.responseJSON &&
                error.responseJSON.error &&
                error.responseJSON.error.data);
        const errorName = errorData?.name || "";
        // check for buy token not authorized for trade
        if (
            errorName === "BUY_TOKEN_NOT_AUTHORIZED_FOR_TRADE" ||
            (error.message &&
                error.message.includes("BUY_TOKEN_NOT_AUTHORIZED_FOR_TRADE"))
        ) {
            await callback?.({
                text: `\nThe buy token: ${formatTokenMention(buyTokenSymbol, buyTokenAddress)} is not supported yet. Please try with a different token.`,
            });
        } else {
            if (!error.message?.includes("Insufficient balance")) {
                await callback?.({
                    text: `\nAn error occurred while processing your request. Please try again.`,
                    content: {
                        details: `An error occurred while processing your request. Please try again.`,
                    },
                });
            }
        }
        throw new Error(
            `[tokenSwap] [${moxieUserId}] [swap] Error getting 0x quote: ${error.message}`
        );
    }

    // if (sellTokenSymbol != "ETH") { // skip for ETH
    // signature related
    let signResponse: MoxieWalletSignTypedDataResponseType | undefined;
    try {
        elizaLogger.debug(
            traceId,
            `[tokenSwap] [${moxieUserId}] [swap] quote.permit2.eip712: ${JSON.stringify(quote.permit2?.eip712)}`
        );
        if (quote.permit2?.eip712) {
            signResponse = await walletClient.signTypedData(
                quote.permit2.eip712.domain,
                quote.permit2.eip712.types,
                quote.permit2.eip712.message,
                quote.permit2.eip712.primaryType
            );
            elizaLogger.debug(
                traceId,
                `[tokenSwap] [${moxieUserId}] [swap] signResponse: ${JSON.stringify(signResponse)}`
            );
        }

        if (signResponse && signResponse.signature && quote.transaction?.data) {
            const signatureLengthInHex = numberToHex(
                size(signResponse.signature as MoxieHex),
                {
                    signed: false,
                    size: 32,
                }
            );
            // Append signature length and data to transaction
            quote.transaction.data = concat([
                quote.transaction.data,
                signatureLengthInHex,
                signResponse.signature,
            ]);
            elizaLogger.debug(
                traceId,
                `[tokenSwap] [${moxieUserId}] [swap] quote.transaction.data: ${JSON.stringify(quote.transaction.data)}`
            );
        }
    } catch (error) {
        elizaLogger.error(
            traceId,
            `[tokenSwap] [${moxieUserId}] [swap] Error signing typed data: ${JSON.stringify(error)}`
        );
        await callback?.({
            text: `\nAn error occurred while processing your request. Please try again.`,
            content: {
                error: "SIGN_TYPED_DATA_FAILED",
                details: `An error occurred while processing your request. Please try again.`,
            },
        });
    }
    // }

    // execute 0x swap
    let tx: MoxieWalletSendTransactionResponseType | null = null;
    try {
        tx = await execute0xSwap({
            traceId: traceId,
            moxieUserId: moxieUserId,
            walletAddress: agentWalletAddress,
            quote: quote,
            walletClient: walletClient,
        });
        elizaLogger.debug(
            traceId,
            `[tokenSwap] [${moxieUserId}] [swap] 0x tx: ${JSON.stringify(tx)}`
        );
    } catch (error) {
        elizaLogger.error(
            traceId,
            `[tokenSwap] [${moxieUserId}] [swap] Error executing 0x swap: ${JSON.stringify(error)}`
        );
        await callback?.({
            text: `\nAn error occurred while processing your request. Please try again.`,
            content: {
                error: `${sellTokenSymbol}_TO_${buyTokenSymbol}_SWAP_FAILED`,
                details: `An error occurred while processing your request. Please try again.`,
            },
        });
        throw new Error(
            `[tokenSwap] [${moxieUserId}] [swap] Error executing 0x swap: ${JSON.stringify(error)}`
        );
    }

    await callback?.(
        swapInProgressTemplate(
            sellTokenSymbol,
            sellTokenAddress,
            buyTokenSymbol,
            buyTokenAddress,
            tx.hash
        )
    );

    // wait for tx to be mined
    let txnReceipt: ethers.TransactionReceipt | null;
    try {
        txnReceipt = await handleTransactionStatus(
            traceId,
            moxieUserId,
            provider,
            tx.hash
        );
        if (!txnReceipt) {
            elizaLogger.error(
                traceId,
                `[tokenSwap] [${moxieUserId}] [swap] [TRANSACTION_RECEIPT_NULL] txnReceipt is null`
            );
            await callback?.({
                text: `\nTransaction failed. Please try again.`,
                content: {
                    details: `Transaction receipt is not present for ${tx.hash}.`,
                },
            });
            throw new Error(
                "[TRANSACTION_RECEIPT_NULL] Transaction receipt is null"
            );
        }
    } catch (error) {
        elizaLogger.error(
            traceId,
            `[tokenSwap] [${moxieUserId}] [swap] Error handling transaction status: ${JSON.stringify(error)}`
        );
        await callback?.({
            text: `\nAn error occurred while processing your request. Please try again.`,
            content: {
                error: "TRANSACTION_FAILED",
                details: `An error occurred while processing your request. Please try again.`,
            },
        });
        return buyAmountInWEI;
    }

    elizaLogger.debug(
        traceId,
        `[tokenSwap] [${moxieUserId}] [swap] 0x swap txnReceipt: ${JSON.stringify(txnReceipt)}`
    );
    if (txnReceipt.status == 1) {
        await callback?.(
            swapCompletedTemplate(
                sellTokenSymbol,
                sellTokenAddress,
                buyTokenSymbol,
                buyTokenAddress,
                buyAmountInWEI,
                buyTokenDecimals
            )
        );
        return buyAmountInWEI;
    } else {
        elizaLogger.error(
            traceId,
            `[tokenSwap] [${moxieUserId}] [swap] 0x swap failed: ${tx.hash} `
        );
        await callback?.({
            text: `\nAn error occurred while processing your request. Please try again.`,
            content: {
                error: `${sellTokenSymbol}_TO_${buyTokenSymbol}_SWAP_FAILED`,
                details: `An error occurred while processing your request. Please try again.`,
            },
        });
        return buyAmountInWEI;
    }
}

/**
 * Get 0x swap quote
 * @param moxieUserId - The moxie user id
 * @param sellAmountBaseUnits - The sell amount
 * @param buyTokenAddress - The buy token address
 * @param walletAddress - The wallet address
 * @param sellTokenAddress - The sell token address
 * @returns The quote
 */
export const get0xSwapQuote = async ({
    traceId,
    moxieUserId,
    sellAmountBaseUnits,
    buyTokenAddress,
    buyTokenSymbol,
    walletAddress,
    sellTokenAddress,
    sellTokenSymbol,
}: {
    traceId: string;
    moxieUserId: string;
    sellAmountBaseUnits: string;
    buyTokenAddress: string;
    buyTokenSymbol: string;
    walletAddress: string;
    sellTokenAddress: string;
    sellTokenSymbol: string;
}) => {
    const MAX_RETRIES = SWAP_RETRY_COUNT;
    const RETRY_DELAY = SWAP_RETRY_DELAY;

    let retryCount = 0;
    let adjustedSlippage = INITIAL_SLIPPAGE_IN_BPS;
    while (retryCount < MAX_RETRIES) {
        try {
            if (!process.env.ZERO_EX_API_KEY) {
                return mockGetQuoteResponse;
            }

            elizaLogger.debug(
                traceId,
                `[get0xSwapQuote] [${moxieUserId}] input details: ` +
                    `[walletAddress: ${walletAddress}] ` +
                    `[sellTokenAddress: ${sellTokenAddress}] ` +
                    `[buyTokenAddress: ${buyTokenAddress}] ` +
                    `[sellAmountBaseUnits: ${sellAmountBaseUnits}] ` +
                    `[buyTokenSymbol: ${buyTokenSymbol}] ` +
                    `[sellTokenSymbol: ${sellTokenSymbol}] ` +
                    `[adjustedSlippage: ${adjustedSlippage}]`
            );
            const quote = (await zxClient.swap.permit2.getQuote.query({
                sellAmount: sellAmountBaseUnits,
                sellToken: sellTokenAddress,
                buyToken: buyTokenAddress,
                chainId: Number(process.env.CHAIN_ID || "8453"),
                taker: walletAddress,
                slippageBps: adjustedSlippage,
                swapFeeToken: isStableCoin(buyTokenSymbol)
                    ? buyTokenAddress
                    : isStableCoin(sellTokenSymbol)
                      ? sellTokenAddress
                      : sellTokenAddress, // default to sellToken if neither present in stableCoins env variable
                swapFeeBps: Number(process.env.SWAP_FEE_BPS),
                swapFeeRecipient: process.env.SWAP_FEE_RECIPIENT,
            })) as GetQuoteResponse;

            return quote;
        } catch (error) {
            retryCount++;

            if (retryCount >= MAX_RETRIES) {
                elizaLogger.error(
                    traceId,
                    `[ERROR] [get0xSwapQuote] [${moxieUserId}] [ERROR] Failed to get 0x swap quote after ${MAX_RETRIES} attempts: ${JSON.stringify(error)}`
                );
                throw error;
            }
            elizaLogger.error(
                traceId,
                `[ERROR] [get0xSwapQuote] [${moxieUserId}] [RETRY ${retryCount}/${MAX_RETRIES}] Failed to get 0x swap quote: ${JSON.stringify(error)}`
            );

            // increments the slippage for each retry
            adjustedSlippage += SLIPPAGE_INCREMENT_PER_RETRY_IN_BPS;
            elizaLogger.debug(
                traceId,
                `[get0xSwapQuote] [${moxieUserId}] adjustedSlippage after retry ${retryCount}: ${adjustedSlippage}`
            );

            // Wait before retrying
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
        }
    }
};

const isStableCoin = (tokenSymbol: string) => {
    // Map of stable coins by symbol
    const stableCoins = (process.env.STABLE_COINS || "USDC,USDT,DAI,ETH,WETH")
        .split(",")
        .map((coin) => coin.trim());
    return stableCoins.includes(tokenSymbol.toUpperCase());
};

/**
 * Execute 0x swap with 20% buffer for gas limit
 * @param moxieUserId - The moxie user id
 * @param walletAddress - The wallet address
 * @param quote - The quote
 * @returns The transaction response
 */
export const execute0xSwap = async ({
    traceId,
    moxieUserId,
    walletAddress,
    quote,
    walletClient,
}: {
    traceId: string;
    moxieUserId: string;
    walletAddress: string;
    quote: GetQuoteResponse;
    walletClient: MoxieWalletClient;
}): Promise<MoxieWalletSendTransactionResponseType> => {
    elizaLogger.debug(
        traceId,
        `[execute0xSwap] [${moxieUserId}] input details: [${walletAddress}] [${quote.transaction.to}] [${quote.transaction.value}] [${quote.transaction.data}] [${quote.transaction.gas}] [${quote.transaction.gasPrice}]`
    );

    try {
        const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
        const feeData = await provider.getFeeData();
        elizaLogger.debug(
            traceId,
            `[execute0xSwap] [${moxieUserId}] feeData: ${JSON.stringify(feeData)}`
        );
        const maxPriorityFeePerGas =
            (feeData.maxPriorityFeePerGas! * BigInt(120)) / BigInt(100);
        const maxFeePerGas =
            (feeData.maxFeePerGas! * BigInt(120)) / BigInt(100);
        const transactionInput: MoxieWalletSendTransactionInputType = {
            address: walletAddress,
            chainType: "ethereum",
            caip2: `eip155:${process.env.CHAIN_ID || "8453"}`,
            transaction: {
                to: quote.transaction.to,
                value: Number(quote.transaction.value),
                data: quote.transaction.data,
                gasLimit: Math.ceil(Number(quote.transaction.gas) * 1.2), // added 20% buffer
                gasPrice: Number(quote.transaction.gasPrice),
                chainId: Number(process.env.CHAIN_ID || "8453"),
            },
        };
        elizaLogger.debug(
            traceId,
            `[execute0xSwap] [${moxieUserId}] transactionInput: ${JSON.stringify(transactionInput)}`
        );
        const tx = await walletClient.sendTransaction(
            process.env.CHAIN_ID || "8453",
            {
                fromAddress: walletAddress,
                toAddress: quote.transaction.to,
                value: Number(quote.transaction.value),
                data: quote.transaction.data,
                gasLimit: Math.ceil(Number(quote.transaction.gas) * 1.2), // added 20% buffer
                gasPrice: Number(quote.transaction.gasPrice),
                maxFeePerGas: Number(maxFeePerGas),
                maxPriorityFeePerGas: Number(maxPriorityFeePerGas),
            }
        );
        elizaLogger.debug(
            traceId,
            `[execute0xSwap] [${moxieUserId}] tx hash: ${tx.hash}`
        );
        return tx;
    } catch (error) {
        elizaLogger.error(
            traceId,
            `[execute0xSwap] [${moxieUserId}] [ERROR] Error executing 0x swap: ${JSON.stringify(error)}`
        );
        throw new Error("Failed to execute 0x swap. Please try again later.");
    }
};

/**
 * Checks the allowance of a token and approves spending if necessary
 * @param moxieUserId The ID of the Moxie user making the purchase
 * @param walletAddress The address of the wallet to check allowance for
 * @param tokenAddress The address of the token to check allowance for
 * @param spenderAddress The address of the spender to check allowance for
 * @param amountInWEI The amount of tokens to check allowance for
 * @param provider The provider to use for the transaction
 * @param walletClient The Moxie wallet client to use for the transaction
 * @param callback The callback to use for the transaction
 */
export async function checkAllowanceAndApproveSpendRequest(
    traceId: string,
    moxieUserId: string,
    walletAddress: string,
    tokenAddress: string,
    spenderAddress: string,
    amountInWEI: bigint,
    provider: ethers.Provider,
    walletClient: MoxieWalletClient
) {
    // Add input validation
    if (!walletAddress || !ethers.isAddress(walletAddress)) {
        throw new Error("Invalid wallet address");
    }
    if (!tokenAddress || !ethers.isAddress(tokenAddress)) {
        throw new Error("Invalid token address");
    }
    if (!spenderAddress || !ethers.isAddress(spenderAddress)) {
        throw new Error("Invalid spender address");
    }
    if (amountInWEI <= 0) {
        throw new Error("Invalid amount");
    }

    elizaLogger.debug(
        traceId,
        `[${moxieUserId}] [checkAllowanceAndApproveSpendRequest] called, walletAddress: ${walletAddress}, tokenAddress: ${tokenAddress}, spenderAddress: ${spenderAddress}, tokenAmount: ${amountInWEI}`
    );
    try {
        // First, create contract instance to check allowance
        const tokenContract = new ethers.Contract(
            tokenAddress,
            ERC20_ABI,
            provider
        );

        // Check current allowance
        const currentAllowance: bigint = await tokenContract.allowance(
            walletAddress,
            spenderAddress
        );
        elizaLogger.debug(
            traceId,
            `[${moxieUserId}] [checkAllowanceAndApproveSpendRequest] current ${spenderAddress} allowance for wallet address: ${walletAddress}, ${currentAllowance}`
        );

        // If allowance is already sufficient, return early
        if (currentAllowance && currentAllowance >= amountInWEI) {
            elizaLogger.debug(
                traceId,
                `[${moxieUserId}] [checkAllowanceAndApproveSpendRequest] Sufficient allowance already exists. hence no approval is required`
            );
            return true;
        }

        elizaLogger.debug(
            traceId,
            `[${moxieUserId}] [checkAllowanceAndApproveSpendRequest] Sufficient allowance not exists. hence proceeeding with approval is required`
        );

        // Get gas estimate for approval transaction
        const approveData = encodeFunctionData({
            abi: ERC20_ABI,
            args: [spenderAddress, MAX_UINT256.toString()],
            functionName: "approve",
        });

        // If we need to approve, create the approve transaction
        const feeData = await provider.getFeeData();
        elizaLogger.debug(
            traceId,
            `[${moxieUserId}] [checkAllowanceAndApproveSpendRequest] feeData: ${JSON.stringify(feeData)}`
        );

        // Add 20% buffer to gas fees
        const maxFeePerGas =
            (feeData.maxFeePerGas! * BigInt(120)) / BigInt(100);
        const maxPriorityFeePerGas =
            (feeData.maxPriorityFeePerGas! * BigInt(120)) / BigInt(100);

        const approveRequestInput: MoxieWalletSendTransactionInputType = {
            address: walletAddress,
            chainType: "ethereum",
            caip2: "eip155:" + (process.env.CHAIN_ID || "8453"),
            transaction: {
                from: walletAddress,
                to: tokenAddress,
                data: approveData,
                maxFeePerGas: Number(maxFeePerGas),
                maxPriorityFeePerGas: Number(maxPriorityFeePerGas),
                chainId: Number(process.env.CHAIN_ID || "8453"),
            },
        };

        elizaLogger.debug(
            traceId,
            `[${moxieUserId}] [checkAllowanceAndApproveSpendRequest] approve request: ${JSON.stringify(
                approveRequestInput,
                (key, value) =>
                    typeof value === "bigint" ? value.toString() : value
            )}`
        );
        const approveResponse = await walletClient.sendTransaction(
            process.env.CHAIN_ID || "8453",
            {
                fromAddress: walletAddress,
                toAddress: tokenAddress,
                data: approveData,
                maxFeePerGas: Number(maxFeePerGas),
                maxPriorityFeePerGas: Number(maxPriorityFeePerGas),
            }
        );
        elizaLogger.debug(
            traceId,
            `[${moxieUserId}] [checkAllowanceAndApproveSpendRequest] approval txn_hash: ${JSON.stringify(approveResponse)}`
        );
        const approvalTxHash = approveResponse.hash;

        // check if the approve txn is success.
        if (approveResponse && approvalTxHash) {
            let receipt: ethers.TransactionReceipt;
            try {
                receipt = await provider.waitForTransaction(
                    approvalTxHash,
                    1,
                    TRANSACTION_RECEIPT_TIMEOUT
                );
            } catch (error) {
                if (error.message.includes("timeout")) {
                    throw new Error("Approval transaction timed out");
                }
                throw error;
            }
            elizaLogger.debug(
                traceId,
                `[${moxieUserId}] [checkAllowanceAndApproveSpendRequest] approval tx receipt: ${JSON.stringify(receipt)}`
            );
            if (receipt.status === 1) {
                elizaLogger.debug(
                    traceId,
                    `[${moxieUserId}] [checkAllowanceAndApproveSpendRequest] [SUCCESS] Approval transaction successful: ${approvalTxHash}`
                );
            } else {
                elizaLogger.error(
                    traceId,
                    `[${moxieUserId}] [checkAllowanceAndApproveSpendRequest] [ERROR] Approval transaction failed: ${approvalTxHash}`
                );
                throw new Error(`Approval transaction failed`);
            }
        } else {
            elizaLogger.error(
                traceId,
                `[${moxieUserId}] [checkAllowanceAndApproveSpendRequest] [ERROR] No transaction hash returned for approval`
            );
            throw new Error(`Approval transaction not initiated`);
        }
        return true;
    } catch (error) {
        elizaLogger.error(
            traceId,
            `[${moxieUserId}] [checkAllowanceAndApproveSpendRequest] [ERROR] error in checkAllowanceAndApproveSpendRequest, ${JSON.stringify(error)}`
        );
        throw error;
    }
}

/**
 * Handles the status of a blockchain transaction by waiting for confirmation and checking the receipt
 * @param moxieUserId The ID of the Moxie user initiating the transaction
 * @param provider The Ethereum JSON RPC provider used to interact with the blockchain
 * @param txHash The transaction hash to monitor
 * @returns Promise that resolves to the transaction receipt if successful, or null if failed
 * @throws Error if transaction times out or fails
 */
export async function handleTransactionStatus(
    traceId: string,
    moxieUserId: string,
    provider: ethers.JsonRpcProvider,
    txHash: string
): Promise<ethers.TransactionReceipt | null> {
    elizaLogger.debug(
        traceId,
        `[${moxieUserId}] [handleTransactionStatus] called with input details: [${txHash}]`
    );
    let txnReceipt: ethers.TransactionReceipt | null = null;

    try {
        txnReceipt = await provider.waitForTransaction(
            txHash,
            1,
            TRANSACTION_RECEIPT_TIMEOUT
        );
        if (!txnReceipt) {
            elizaLogger.error(
                traceId,
                `[${moxieUserId}] [handleTransactionStatus] Transaction receipt timeout`
            );
            return null;
        }

        if (txnReceipt.status === 1) {
            elizaLogger.debug(
                traceId,
                `[${moxieUserId}] [handleTransactionStatus] transaction successful: ${txHash}`
            );
            return txnReceipt;
        } else {
            elizaLogger.error(
                traceId,
                `[${moxieUserId}] [handleTransactionStatus] transaction failed: ${txHash} with status: ${txnReceipt.status}`
            );
            return null;
        }
    } catch (error) {
        const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
        elizaLogger.error(
            traceId,
            `[${moxieUserId}] [handleTransactionStatus] Error waiting for transaction receipt: ${errorMessage}`
        );
        return null;
    }
}

/**
 * Get the price of a token in USD
 * @param context
 * @param amount
 * @param tokenAddress
 * @param tokenDecimals
 * @param output
 * @returns the amount of tokens equivalent to the USD amount
 */
export async function getPrice(
    traceId: string,
    moxieUserId: string,
    amount: string,
    sourceTokenAddress: string,
    sourceTokenDecimals: number,
    sourceTokenSymbol: string,
    targetTokenAddress: string,
    targetTokenDecimals: number,
    targetTokenSymbol: string
): Promise<string> {
    try {
        elizaLogger.debug(
            traceId,
            `[getPrice] started with [${moxieUserId}] ` +
                `[amount]: ${amount}, ` +
                `[sourceTokenAddress]: ${sourceTokenAddress}, ` +
                `[sourceTokenDecimals]: ${sourceTokenDecimals}, ` +
                `[sourceTokenSymbol]: ${sourceTokenSymbol}, ` +
                `[targetTokenAddress]: ${targetTokenAddress}, ` +
                `[targetTokenDecimals]: ${targetTokenDecimals}, ` +
                `[targetTokenSymbol]: ${targetTokenSymbol}`
        );

        // check if the source token is ETH
        if (sourceTokenAddress === ETH_ADDRESS) {
            sourceTokenAddress = WETH_ADDRESS;
        }
        // check if the target token is ETH
        if (targetTokenAddress === ETH_ADDRESS) {
            targetTokenAddress = WETH_ADDRESS;
        }

        const sourceTokenWithNetworkId = `${sourceTokenAddress}:${BASE_NETWORK_ID}`;
        const targetTokenWithNetworkId = `${targetTokenAddress}:${BASE_NETWORK_ID}`;

        const tokenDetails = await getTokenDetails([
            sourceTokenWithNetworkId,
            targetTokenWithNetworkId,
        ]);
        elizaLogger.debug(
            traceId,
            `[getPrice] [${moxieUserId}] [TOKEN_DETAILS] ${JSON.stringify(tokenDetails)}`
        );

        if (!tokenDetails || tokenDetails.length === 0) {
            elizaLogger.error(
                traceId,
                `[getPrice] [${moxieUserId}] [ERROR] Error getting token details: ${tokenDetails}`
            );
            throw new Error(
                `Failed to get token details from codex with error`
            );
        }

        const sourceTokenDetail = tokenDetails.find(
            (token) =>
                token.tokenAddress.toLowerCase() ===
                sourceTokenAddress.toLowerCase()
        );
        const targetTokenDetail = tokenDetails.find(
            (token) =>
                token.tokenAddress.toLowerCase() ===
                targetTokenAddress.toLowerCase()
        );

        // if source / target token details are not found, throw an error
        if (!sourceTokenDetail || !targetTokenDetail) {
            elizaLogger.error(
                traceId,
                `[getPrice] [${moxieUserId}] [ERROR] source / target token details not found`
            );
            throw new Error(
                `Failed to get token details from codex with error`
            );
        }
        if (!sourceTokenDetail?.priceUSD) {
            elizaLogger.error(
                traceId,
                `[getPrice] [${moxieUserId}] [ERROR] priceUSD not found for source token: ${sourceTokenDetail}`
            );
            throw new Error(
                `Failed to get token price in USD for token: ${sourceTokenWithNetworkId}`
            );
        }

        const sourceTokenPriceInUSD = new Decimal(sourceTokenDetail.priceUSD);
        elizaLogger.debug(
            traceId,
            `[getPrice] [${moxieUserId}] [${sourceTokenSymbol}] Price USD: ${sourceTokenPriceInUSD}`
        );

        // check for the target token price in USD
        if (!targetTokenDetail?.priceUSD) {
            elizaLogger.error(
                traceId,
                `[getPrice] [${moxieUserId}] [ERROR] priceUSD not found for target token: ${targetTokenDetail}`
            );
            throw new Error(
                `Failed to get token price in USD for token: ${targetTokenWithNetworkId}`
            );
        }

        const targetTokenPriceInUSD = new Decimal(targetTokenDetail.priceUSD);
        elizaLogger.debug(
            traceId,
            `[getPrice] [${moxieUserId}] [${targetTokenSymbol}] Price USD: ${targetTokenPriceInUSD}`
        );

        // convert the amount to ether
        const amountinEther = ethers.formatUnits(amount, sourceTokenDecimals);

        elizaLogger.debug(
            traceId,
            `[getPrice] [${moxieUserId}] [${sourceTokenSymbol}] amount in ether: ${amountinEther}`
        );

        // calculate the amount of target token that can be bought with the amount using the source token price in USD
        const amountInTargetToken = new Decimal(amountinEther.toString())
            .mul(sourceTokenPriceInUSD.toString())
            .div(targetTokenPriceInUSD.toString())
            .toString();

        const amountInTargetTokenFixed = new Decimal(amountInTargetToken)
            .toFixed(Number(targetTokenDecimals))
            .replace(/\.?0+$/, ""); // Remove trailing zeros and decimal point if whole number

        elizaLogger.debug(
            traceId,
            `[getPrice] [${moxieUserId}] [${targetTokenSymbol}] amount: ${amountInTargetTokenFixed}`
        );

        // convert to wei
        return ethers
            .parseUnits(amountInTargetTokenFixed, targetTokenDecimals)
            .toString();
    } catch (error) {
        elizaLogger.error(
            traceId,
            `[getPrice] [${moxieUserId}] [ERROR] Unhandled error: ${error.message}`
        );
        throw error;
    }
}

/**
 * Burns a token by transferring it to the 0x0000000000000000000000000000000000000000 address
 * @param traceId
 * @param moxieUserId
 * @param tokenAddress
 * @param amountInWei
 * @param walletAddress
 * @param walletClient
 * @returns the transaction hash
 */
export async function burnToken(
    traceId: string,
    moxieUserId: string,
    tokenAddress: string,
    amountInWei: string,
    walletAddress: string,
    walletClient: MoxieWalletClient
) {
    try {
        elizaLogger.debug(
            traceId,
            `[burnToken] started with [${moxieUserId}] ` +
                `[tokenAddress]: ${tokenAddress}, ` +
                `[amountInWei]: ${amountInWei}, ` +
                `[walletAddress]: ${walletAddress}`
        );
        const transferData = encodeFunctionData({
            abi: ERC20_ABI,
            args: ["0x0000000000000000000000000000000000000000", amountInWei],
            functionName: "transfer",
        });

        // transfer the token to 0x0000000000000000000000000000000000000000 address
        const { hash } = await walletClient.sendTransaction(
            process.env.CHAIN_ID || "8453",
            {
                fromAddress: walletAddress,
                toAddress: "0x0000000000000000000000000000000000000000",
                data: transferData,
            }
        );
        elizaLogger.debug(
            traceId,
            `[burnToken] [${moxieUserId}] [SUCCESS] Burn transaction successful: ${hash}`
        );
        return hash;
    } catch (error) {
        elizaLogger.error(
            traceId,
            `[burnToken] [${moxieUserId}] [ERROR] Unhandled error: ${error.message}`
        );
        throw error;
    }
}
