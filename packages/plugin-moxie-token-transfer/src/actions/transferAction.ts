import {
    composeContext,
    elizaLogger,
    generateObjectDeprecated,
    HandlerCallback,
    IAgentRuntime,
    Memory,
    ModelClass,
    ModelProviderName,
    State,
} from "@moxie-protocol/core";
import { tokenTransferTemplate } from "../templates/template";
import * as agentLib from "@moxie-protocol/moxie-agent-lib";
import {
    CallbackTemplate,
    TransactionResponse,
    FunctionResponse,
    Balance,
    Context,
    TokenDetails,
    Transfer,
} from "../types/types";
import * as callBackTemplate from "../templates/callBackTemplate";
import { ethers } from "ethers";
import {
    getERC20Balance,
    getERC20Decimals,
    getNativeTokenBalance,
} from "../service/erc20";
import {
    getSubjectTokenDetailsBySubjectAddress,
    SubjectToken,
} from "../utils/subgraph";
import { encodeFunctionData } from "viem";
import { handleTransactionStatus } from "../utils/common";
import {
    BASE_NETWORK_ID,
    ERC20_ABI,
    ETH_ADDRESS,
    MOXIE_TOKEN_ADDRESS,
    MOXIE_TOKEN_DECIMALS,
    USDC_ADDRESS,
    USDC_TOKEN_DECIMALS,
    WETH_ADDRESS,
} from "../constants";
import { get0xPrice } from "../utils/0xApis";
import Decimal from "decimal.js";
import { getERC20TokenSymbol } from "@moxie-protocol/moxie-agent-lib";
import {
    CreateRuleInput,
    RuleType,
    RuleTrigger,
    AddRuleExecutionLogInput,
    moxieUserService,
    SwapSource,
    BuyAmountValueType
} from "@moxie-protocol/moxie-agent-lib";

// Consider adding JSDoc for the tokenTransferAction object
export const tokenTransferAction = {
    suppressInitialMessage: true,
    name: "TOKEN_TRANSFERS",
    description:
        "This action allows user to send ERC20 tokens and creator coins. Supports various input formats like dollar amounts ($10), token symbols, @mentions for recipients, Ethereum wallet addresses, ENS domain names, and $[token|tokenAddress] syntax for specific token references.",
    handler: async (
        runtime: IAgentRuntime,
        _message: Memory,
        state: State,
        _options: any,
        callback?: HandlerCallback
    ) => {
        const traceId = _message.id;
        const provider = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL);
        elizaLogger.debug(
            traceId,
            `[transferTokenAction] started with message: ${_message.content.text}`
        );

        // create the context
        const context: Context = {
            traceId,
            runtime,
            state,
            provider,
        };

        // pre validate the required data
        const preValidationResult = await preValidateRequiredData(context);
        if (preValidationResult) {
            await callback?.(preValidationResult);
            return true;
        }

        // pick moxie user info from state
        const moxieUserInfo = state.moxieUserInfo as agentLib.MoxieUser;
        const moxieUserId = moxieUserInfo.id;
        const agentWallet = state.agentWallet as agentLib.MoxieClientWallet;

        // add moxie user id to context
        context.moxieUserId = moxieUserId;

        try {
            // process the message and extract the transfer details
            const transferOptions = await processMessage(
                context,
                _message,
                runtime,
                state
            );
            if (transferOptions.callBackTemplate) {
                elizaLogger.debug(
                    traceId,
                    `[transferTokenAction] [${moxieUserId}] [processMessage] transferOptions: ${JSON.stringify(transferOptions)}`
                );
                await callback?.({
                    text: transferOptions.callBackTemplate.text,
                });
                return true;
            }

            // Validate transfer content
            const validationResult = await isValidTransferContent(
                context,
                transferOptions.data
            );
            if (!validationResult) {
                elizaLogger.debug(
                    traceId,
                    `[transferTokenAction] [${moxieUserId}] [isValidTransferContent] validationResult: ${JSON.stringify(validationResult)}`
                );
                await callback?.({
                    content: validationResult.callBackTemplate.content,
                    text: validationResult.callBackTemplate.text,
                });
                return true;
            }

            // process the transfer
            const transferResult = await processTransfer(
                context,
                transferOptions.data,
                agentWallet,
                callback
            );
            if (transferResult && transferResult.callBackTemplate) {
                await callback?.({
                    content: transferResult.callBackTemplate.content,
                    text: transferResult.callBackTemplate.text,
                });
                return true;
            }
            return true;
        } catch (error) {
            elizaLogger.error(
                traceId,
                `[tokenTransferAction] [${moxieUserId}] [ERROR] error: ${error}`
            );
            const errorTemplate = callBackTemplate.APPLICATION_ERROR(
                `Error processing transfer: ${error.message}`
            );
            await callback?.({
                content: errorTemplate.content,
                text: errorTemplate.text,
            });
            return true;
        }
    },
    template: tokenTransferTemplate,
    validate: async (runtime: IAgentRuntime, message: Memory) => {
        return true; // Consider adding actual validation logic
    },
    similes: [
        "SEND_TOKENS",
        "SEND_COINS",
        "SEND_CRYPTO",
        "SEND_FUNDS",
        "SEND_PAYMENT",
        "SEND_CREATOR_COIN",
        "SEND_ERC20",
        "SEND_TOKEN",
        "TRANSFER_PAYMENT",
        "TRANSFER_CREATOR_COIN",
        "TRANSFER_ERC20",
        "TRANSFER_TOKENS",
    ],
    examples: [], // Consider adding examples
};

/**
 * Handles validations for the transfer token action
 * @param moxieUserId - The ID of the Moxie user
 * @param runtime - The runtime environment
 * @param message - The message to validate
 * @param state - The state of the agent
 */
function handleValidations(
    moxieUserId: string,
    runtime: IAgentRuntime,
    message: Memory,
    state: State
) {
    elizaLogger.debug(`[transferTokenAction] [${moxieUserId}] started`);

    // check if the context contains the agent wallet
    const agentWallet = state.agentWallet;
    if (!agentWallet) {
        throw new Error("Agent wallet not found");
    }
}

/**
 * Validates the content of a transfer transaction
 * @param context - The context of the agent
 * @param content - The content of the transfer transaction
 * @returns A promise that resolves to a FunctionResponse<TransactionResponse>
 */
async function isValidTransferContent(
    context: Context,
    content: TransactionResponse
): Promise<FunctionResponse<TransactionResponse>> {
    elizaLogger.debug(
        context.traceId,
        `[tokenTransfer] [${context.moxieUserId}] [isValidTransferContent] content: ${JSON.stringify(content)}`
    );

    // Validate basic content structure
    if (!content?.transfers?.length) {
        elizaLogger.error(
            context.traceId,
            `[tokenTransfer] [${context.moxieUserId}] [isValidTransferContent] Invalid content structure: ${JSON.stringify(content)}`
        );
        return {
            callBackTemplate: callBackTemplate.APPLICATION_ERROR(
                "Missing or empty transfers array"
            ),
        };
    }

    // Validate each transfer
    for (const transfer of content.transfers) {
        // Check required fields based on Transfer interface
        if (!transfer.sender || !transfer.recipient || !transfer.token) {
            elizaLogger.error(
                context.traceId,
                `[tokenTransfer] [${context.moxieUserId}] [isValidTransferContent] Missing required fields in transfer: ${JSON.stringify(transfer)}`
            );
            return {
                callBackTemplate: callBackTemplate.APPLICATION_ERROR(
                    "Transfer missing required fields: sender, recipient, or token"
                ),
            };
        }

        // For direct transfers, validate transfer amount
        if (
            !transfer.balance &&
            (!transfer.transferAmount || transfer.transferAmount <= 0)
        ) {
            elizaLogger.error(
                context.traceId,
                `[tokenTransfer] [${context.moxieUserId}] [isValidTransferContent] Invalid quantity: transferAmount=${transfer.transferAmount}`
            );
            return {
                callBackTemplate: callBackTemplate.APPLICATION_ERROR(
                    "Transfer amount must be positive for direct transfers"
                ),
            };
        }

        // For USD transfers, validate value_type
        if (transfer.value_type && transfer.value_type !== "USD") {
            elizaLogger.error(
                context.traceId,
                `[tokenTransfer] [${context.moxieUserId}] [isValidTransferContent] Invalid value_type: ${transfer.value_type}`
            );
            return {
                callBackTemplate: callBackTemplate.APPLICATION_ERROR(
                    "Value type must be 'USD' if specified"
                ),
            };
        }

        // Validate balance fields if present
        if (transfer.balance && transfer.balance.type) {
            const { source_token, type, percentage } = transfer.balance;

            if (
                !source_token ||
                !type ||
                !["FULL", "PERCENTAGE"].includes(type)
            ) {
                elizaLogger.error(
                    context.traceId,
                    `[tokenTransfer] [${context.moxieUserId}] [isValidTransferContent] Invalid balance configuration: ${JSON.stringify(transfer.balance)}`
                );
                return {
                    callBackTemplate: callBackTemplate.APPLICATION_ERROR(
                        "Invalid balance configuration - missing or invalid fields"
                    ),
                };
            }

            if (
                type === "PERCENTAGE" &&
                (typeof percentage !== "number" ||
                    percentage <= 0 ||
                    percentage > 100)
            ) {
                elizaLogger.error(
                    context.traceId,
                    `[tokenTransfer] [${context.moxieUserId}] [isValidTransferContent] Invalid percentage in balance: ${percentage}`
                );
                return {
                    callBackTemplate: callBackTemplate.APPLICATION_ERROR(
                        "Percentage must be between 0 and 100"
                    ),
                };
            }
        }
    }

    return {
        data: null,
    };
}

/**
 * Processes the message and extracts the transfer details
 * @param context - The context of the agent
 * @param message - The message to process
 * @param runtime - The runtime environment
 * @param state - The state of the agent
 * @returns A promise that resolves to a FunctionResponse<TransactionResponse>
 */
async function processMessage(
    context: Context,
    message: Memory,
    runtime: IAgentRuntime,
    state: State
): Promise<FunctionResponse<TransactionResponse>> {
    elizaLogger.debug(
        context.traceId,
        `[tokenTransfer] [${context.moxieUserId}] [processMessage] message called: ${JSON.stringify(message)}`
    );

    const agentWallet = state.agentWallet as agentLib.MoxieClientWallet;

    // Compose transfer context
    let transferContext = composeContext({
        state,
        template: tokenTransferTemplate,
    });

    // Add agent wallet address to transfer context
    transferContext = transferContext.replace(
        "{agentWalletAddress}",
        agentWallet.address
    );

    // Generate transfer content
    const transferOptions = (await generateObjectDeprecated({
        runtime,
        context: transferContext,
        modelClass: ModelClass.LARGE,
        modelConfigOptions: {
            temperature: 0.1,
            maxOutputTokens: 8192,
            modelProvider: ModelProviderName.ANTHROPIC,
            apiKey: process.env.ANTHROPIC_API_KEY,
            modelClass: ModelClass.LARGE,
        },
    })) as TransactionResponse;

    elizaLogger.debug(
        context.traceId,
        `[tokenTransfer] [${context.moxieUserId}] transferOptions: ${JSON.stringify(transferOptions)}`
    );

    // Return early if confirmation required
    if (transferOptions.confirmation_required) {
        return {
            callBackTemplate: {
                text: transferOptions.confirmation_message,
                content: {
                    confirmation_required: true,
                    action: "TOKEN_TRANSFERS",
                    inReplyTo: message.id,
                },
            },
        };
    }

    // Return early if there are errors
    if (transferOptions.error) {
        return {
            callBackTemplate: {
                text: transferOptions.error.prompt_message,
                content: {
                    error: transferOptions.error.missing_fields.join(", "),
                    action: "TOKEN_TRANSFERS",
                    inReplyTo: message.id,
                },
            },
        };
    }

    return {
        data: transferOptions,
    };
}

/**
 * Pre-validates the required data for the transfer token action
 * @param context - The context of the agent
 * @returns A promise that resolves to a CallbackTemplate or null
 */
async function preValidateRequiredData(context: Context) {
    elizaLogger.debug(
        context.traceId,
        `[tokenTransfer]  [preValidateRequiredData] started`
    );

    const state = context.state;
    // check if the base rpc url is set
    if (!process.env.BASE_RPC_URL) {
        elizaLogger.error(
            context.traceId,
            `[tokenTransfer] [preValidateRequiredData] BASE_RPC_URL is not set`
        );
        return callBackTemplate.APPLICATION_ERROR("BASE_RPC_URL is not set");
    }

    // check if the eth mainnet rpc url is set
    if (!process.env.ETH_MAINNET_RPC_URL) {
        elizaLogger.error(
            context.traceId,
            `[tokenTransfer] [preValidateRequiredData] ETH_MAINNET_RPC_URL is not set`
        );
        return callBackTemplate.APPLICATION_ERROR(
            "ETH_MAINNET_RPC_URL is not set"
        );
    }

    // check moxie user info
    const moxieUserInfo = state.moxieUserInfo as agentLib.MoxieUser;
    if (!moxieUserInfo) {
        elizaLogger.error(
            context.traceId,
            `[tokenTransfer] [preValidateRequiredData] Moxie user info not found`
        );
        return callBackTemplate.APPLICATION_ERROR(
            "Moxie user info not found in state"
        );
    }

    // check agent wallet
    const agentWallet = state.agentWallet as agentLib.MoxieClientWallet;
    if (!agentWallet) {
        elizaLogger.error(
            context.traceId,
            `[tokenTransfer] [preValidateRequiredData] Agent wallet not found`
        );
        // return callBackTemplate.APPLICATION_ERROR(
        //     "Agent wallet not found in state"
        // );
        return callBackTemplate.APPLICATION_ERROR_WITH_ERR_MESSAGE(
            "Agent wallet not setup. Please setup your agent wallet and fund it to start trading."
        );
    }

    // check delegate access
    if (!agentWallet.delegated) {
        elizaLogger.error(
            context.traceId,
            `[tokenTransfer] [preValidateRequiredData] Delegate access not found`
        );
        return callBackTemplate.APPLICATION_ERROR_WITH_ERR_MESSAGE(
            "Agent wallet not setup. Please setup your agent wallet and fund it to start trading."
        );
    }

    // check if the moxie wallet client is set
    if (!state.moxieWalletClient) {
        elizaLogger.error(
            context.traceId,
            `[tokenTransfer] [preValidateRequiredData] Senpi wallet client not found`
        );
        return callBackTemplate.APPLICATION_ERROR(
            "Senpi wallet client not found in state"
        );
    }

    return null;
}

/**
 * Processes the transfer of tokens
 * @param context - The context of the agent
 * @param transferOptions - The options for the transfer
 * @param agentWallet - The agent's wallet
 * @param callback - The callback function
 */
async function processTransfer(
    context: Context,
    transferOptions: TransactionResponse,
    agentWallet: agentLib.MoxieClientWallet,
    callback: HandlerCallback
): Promise<FunctionResponse<CallbackTemplate>> {
    elizaLogger.debug(
        context.traceId,
        `[tokenTransfer] [${context.moxieUserId}] [processTransfer] started`
    );

    // Map to cache wallet balances for balance-based transfers to avoid duplicate queries
    const currentWalletBalanceForBalanceBasedSwaps: Map<
        string,
        bigint | undefined
    > = new Map();

    // Process each transfer sequentially
    for (const transfer of transferOptions.transfers) {
        elizaLogger.debug(
            context.traceId,
            `[tokenTransfer] [${context.moxieUserId}] [processTransfer] Processing transfer: ${JSON.stringify(transfer)}`
        );

        try {
            const transferResult = await processSingleTransfer(
                context,
                transfer,
                agentWallet,
                currentWalletBalanceForBalanceBasedSwaps
            );

            // Handle error case
            if (transferResult.callBackTemplate) {
                elizaLogger.error(
                    context.traceId,
                    `[tokenTransfer] [${context.moxieUserId}] [processTransfer] Transfer failed: ${JSON.stringify(transferResult.callBackTemplate)}`
                );
                return {
                    callBackTemplate: transferResult.callBackTemplate,
                };
            }

            // Handle success case
            if (transferResult.data) {
                elizaLogger.debug(
                    context.traceId,
                    `[tokenTransfer] [${context.moxieUserId}] [processTransfer] Transfer successful: ${JSON.stringify(transferResult.data)}`
                );
                await callback({
                    content: transferResult.data.content,
                    text: transferResult.data.text,
                });
            }
        } catch (error) {
            elizaLogger.error(
                context.traceId,
                `[tokenTransfer] [${context.moxieUserId}] [processTransfer] Unexpected error: ${error}`
            );
            return {
                callBackTemplate: callBackTemplate.APPLICATION_ERROR(
                    `Error processing transfer: ${error.message}`
                ),
            };
        }
    }
}

/**
 * Processes a single transfer
 * @param context - The context of the agent
 * @param transfer - The transfer to process
 * @param agentWallet - The agent's wallet
 * @param currentWalletBalanceForBalanceBasedSwaps - The current wallet balance for balance based swaps
 * @returns A promise that resolves to a CallbackTemplate
 */
async function processSingleTransfer(
    context: Context,
    transfer: Transfer,
    agentWallet: agentLib.MoxieClientWallet,
    currentWalletBalanceForBalanceBasedSwaps: Map<string, bigint | undefined>
): Promise<FunctionResponse<CallbackTemplate>> {
    elizaLogger.debug(
        context.traceId,
        `[tokenTransfer] [${context.moxieUserId}] [processSingleTransfer] transfer: ${JSON.stringify(transfer)}`
    );
    try {
        // Validate required transfer parameters
        if (!transfer || !transfer.recipient || !transfer.token) {
            throw new Error("Missing required transfer parameters");
        }

        // extract the transfer details
        const {
            sender,
            recipient,
            token,
            balance,
            transferAmount,
            value_type,
        } = transfer;

        // Resolve token details
        const tokenAddressResult = await resolveTokenAddress(context, token);
        if (!tokenAddressResult.data) {
            elizaLogger.error(
                context.traceId,
                `[tokenTransfer] [${context.moxieUserId}] [processTransfer] resolvedTokenAddress not found`
            );
            return {
                callBackTemplate: tokenAddressResult.callBackTemplate,
            };
        }
        elizaLogger.debug(
            context.traceId,
            `[tokenTransfer] [${context.moxieUserId}] [processTransfer] resolvedTokenAddress: ${JSON.stringify(tokenAddressResult.data)}`
        );

        // Resolve recipient address
        const recipientAddressResult = await resolveRecipientAddress(
            context,
            recipient
        );
        if (!recipientAddressResult.data) {
            elizaLogger.error(
                context.traceId,
                `[tokenTransfer] [${context.moxieUserId}] [processTransfer] resolvedRecipientAddress not found`
            );
            return {
                callBackTemplate: recipientAddressResult.callBackTemplate,
            };
        }
        elizaLogger.debug(
            context.traceId,
            `[tokenTransfer] [${context.moxieUserId}] [processTransfer] resolvedRecipientAddress: ${recipientAddressResult.data}`
        );

        const {
            tokenAddress: resolvedTokenAddress,
            tokenDecimals: resolvedTokenDecimals,
            tokenSymbol: resolvedTokenSymbol,
            tokenType: resolvedTokenType,
            currentMoxiePriceInWEI,
        } = tokenAddressResult.data;
        const resolvedRecipientAddress = recipientAddressResult.data;

        // Handle USD value type conversion
        let transferAmountInWEI: bigint;
        if (value_type === "USD") {
            const conversionResult = await convertUSDToTokenAmount(
                context,
                transferAmount,
                resolvedTokenAddress,
                resolvedTokenDecimals,
                resolvedTokenType,
                currentMoxiePriceInWEI
            );
            if (!conversionResult.data) {
                elizaLogger.error(
                    context.traceId,
                    `[tokenTransfer] [${context.moxieUserId}] [processTransfer] [ERROR] Error converting USD to token amount: ${conversionResult.callBackTemplate}`
                );
                return { callBackTemplate: conversionResult.callBackTemplate };
            }
            transferAmountInWEI = conversionResult.data;
        }
        // Handle balance-based transfer
        else if (balance?.type) {
            const targetQuantity =
                await getTargetQuantityForBalanceBasedTokenTransfer(
                    context,
                    currentWalletBalanceForBalanceBasedSwaps.get(
                        resolvedTokenAddress
                    ),
                    resolvedTokenAddress,
                    resolvedTokenSymbol,
                    agentWallet,
                    balance
                );
            if (targetQuantity.callBackTemplate) {
                elizaLogger.error(
                    context.traceId,
                    `[tokenTransfer] [${context.moxieUserId}] [processTransfer] [BALANCE_BASED_TOKEN_TRANSFER] [ERROR] Error: ${targetQuantity.callBackTemplate}`
                );
                return {
                    callBackTemplate: targetQuantity.callBackTemplate,
                };
            }
            transferAmountInWEI = targetQuantity.data;
            elizaLogger.debug(
                context.traceId,
                `[tokenTransfer] [${context.moxieUserId}] [processTransfer] [BALANCE_BASED_TOKEN_TRANSFER] [transferAmountInWEI]: ${transferAmountInWEI}`
            );
        } else {
            transferAmountInWEI = ethers.parseUnits(
                transferAmount.toString(),
                resolvedTokenDecimals
            );
        }

        // Create rule for the transfer
        const createRuleInput: CreateRuleInput = {
            requestId: context.traceId,
            ruleType: RuleType.AGENT_TOKEN_TRANSFER,
            ruleTrigger: RuleTrigger.USER,
            ruleParameters: {
                baseParams: {
                    sellToken: {
                        symbol: resolvedTokenSymbol,
                        address: resolvedTokenAddress
                    },
                    buyAmount: Number(ethers.formatUnits(transferAmountInWEI, resolvedTokenDecimals)),
                    buyAmountValueType: BuyAmountValueType.TOKEN,
                    transferTo: resolvedRecipientAddress
                }
            }
        };

        const ruleResponse = await moxieUserService.createRule(createRuleInput, process.env.MOXIE_API_KEY || "");
        const ruleId = ruleResponse.ruleId;
        elizaLogger.debug(
            context.traceId,
            `[tokenTransfer] [${context.moxieUserId}] [processTransfer] [transferAmountInWEI]: ${transferAmountInWEI}`
        );

        // check if the agent wallet has enough balance to cover the transfer amount
        const currentBalanceInWEI =
            resolvedTokenAddress.toLowerCase() == ETH_ADDRESS.toLowerCase()
                ? await getNativeTokenBalance(agentWallet.address)
                : await getERC20Balance(
                      resolvedTokenAddress,
                      agentWallet.address
                  );
        elizaLogger.debug(
            context.traceId,
            `[tokenTransfer] [${context.moxieUserId}] [processTransfer] [currentBalanceInWEI]: ${currentBalanceInWEI}`
        );

        if (BigInt(currentBalanceInWEI) < transferAmountInWEI) {
            return {
                callBackTemplate: callBackTemplate.INSUFFICIENT_BALANCE(
                    resolvedTokenSymbol,
                    resolvedTokenAddress,
                    ethers
                        .formatUnits(currentBalanceInWEI, resolvedTokenDecimals)
                        .toString(),
                    ethers
                        .formatUnits(transferAmountInWEI, resolvedTokenDecimals)
                        .toString()
                ),
            };
        }

        // Execute the transfer
        const transferResult = await executeTransfer(
            context,
            resolvedTokenAddress,
            resolvedRecipientAddress,
            agentWallet.address,
            transferAmountInWEI
        );
        if (transferResult.callBackTemplate) {
            elizaLogger.error(
                context.traceId,
                `[tokenTransfer] [${context.moxieUserId}] [processTransfer] [EXECUTE_TRANSFER] [ERROR] Error: ${transferResult.callBackTemplate}`
            );

            // Log failed rule execution
            if (ruleId) {
                const failedExecutionLogInput: AddRuleExecutionLogInput = {
                    ruleId: ruleId,
                    action: RuleType.AGENT_TOKEN_TRANSFER,
                    status: "FAILED",
                    metadata: {
                        transferExecutionMetadata: {
                            metadata: {
                                transferAmountInWEI: transferAmountInWEI.toString(),
                                transferAmount: ethers.formatUnits(transferAmountInWEI, resolvedTokenDecimals),
                                tokenPriceInUSD: "0", // TODO: Get from token details
                                transferAmountInUSD: "0", // TODO: Calculate with actual price
                                tokenAddress: resolvedTokenAddress.toLowerCase(),
                                tokenSymbol: resolvedTokenSymbol,
                                transferTransactionHash: transferResult.data || "",
                                tokenDecimals: resolvedTokenDecimals,
                                recipientAddress: resolvedRecipientAddress.toLowerCase(),
                                agentWalletAddress: agentWallet.address,
                                executionDateTime: new Date().toISOString(),
                                status: "FAILED",
                                verifiedDateTime: new Date().toISOString()
                            }
                        }
                    },
                    inputParams: {
                        baseParams: {
                            sellToken: {
                                symbol: resolvedTokenSymbol,
                                address: resolvedTokenAddress.toLowerCase()
                            },
                            buyAmount: Number(ethers.formatUnits(transferAmountInWEI, resolvedTokenDecimals)),
                            buyAmountValueType: BuyAmountValueType.TOKEN,
                            transferTo: resolvedRecipientAddress.toLowerCase()
                        }
                    },
                    source: SwapSource.AGENT_TOKEN_TRANSFER
                };

                await moxieUserService.addRuleExecutionLog(failedExecutionLogInput, process.env.MOXIE_API_KEY || "");
            }

            return {
                callBackTemplate: transferResult.callBackTemplate,
            };
        }
        elizaLogger.debug(
            context.traceId,
            `[tokenTransfer] [${context.moxieUserId}] [processTransfer] transferResult: ${JSON.stringify(transferResult)}`
        );

        // Verify transaction status
        const txnReceipt = await handleTransactionStatus(
            context,
            transferResult.data
        );
        if (txnReceipt.callBackTemplate) {
            elizaLogger.error(
                context.traceId,
                `[tokenTransfer] [${context.moxieUserId}] [processTransfer] [HANDLE_TRANSACTION_STATUS] [ERROR] Transaction failed`
            );

            // Log failed rule execution
            if (ruleId) {
                const failedExecutionLogInput: AddRuleExecutionLogInput = {
                    ruleId: ruleId,
                    action: SwapSource.AGENT_TOKEN_TRANSFER,
                    status: "FAILED",
                    metadata: {
                        transferExecutionMetadata: {
                            metadata: {
                                transferAmountInWEI: transferAmountInWEI.toString(),
                                transferAmount: ethers.formatUnits(transferAmountInWEI, resolvedTokenDecimals),
                                tokenPriceInUSD: "0", // TODO: Get from token details
                                transferAmountInUSD: "0", // TODO: Calculate with actual price
                                tokenAddress: resolvedTokenAddress.toLowerCase(),
                                tokenSymbol: resolvedTokenSymbol,
                                transferTransactionHash: transferResult.data || "",
                                tokenDecimals: resolvedTokenDecimals,
                                recipientAddress: resolvedRecipientAddress.toLowerCase(),
                                agentWalletAddress: agentWallet.address,
                                executionDateTime: new Date().toISOString(),
                                status: "FAILED",
                                verifiedDateTime: new Date().toISOString()
                            }
                        }
                    },
                    inputParams: {
                        baseParams: {
                            sellToken: {
                                symbol: resolvedTokenSymbol,
                                address: resolvedTokenAddress.toLowerCase()
                            },
                            buyAmount: Number(ethers.formatUnits(transferAmountInWEI, resolvedTokenDecimals)),
                            buyAmountValueType: BuyAmountValueType.TOKEN,
                            transferTo: resolvedRecipientAddress.toLowerCase()
                        }
                    },
                    source: SwapSource.AGENT_TOKEN_TRANSFER
                };

                await moxieUserService.addRuleExecutionLog(failedExecutionLogInput, process.env.MOXIE_API_KEY || "");
            }

            return {
                callBackTemplate: txnReceipt.callBackTemplate,
            };
        }

        if (txnReceipt.data) {
            elizaLogger.debug(
                context.traceId,
                `[tokenTransfer] [${context.moxieUserId}] [processTransfer] [HANDLE_TRANSACTION_STATUS] [SUCCESS] Transaction successful: ${txnReceipt.data}`
            );

            // Log successful rule execution
            if (ruleId) {
                const executionLogInput: AddRuleExecutionLogInput = {
                    ruleId: ruleId,
                    action: SwapSource.AGENT_TOKEN_TRANSFER,
                    status: "SUCCESS",
                    metadata: {
                        transferExecutionMetadata: {
                            metadata: {
                                transferAmountInWEI: transferAmountInWEI.toString(),
                                transferAmount: ethers.formatUnits(transferAmountInWEI, resolvedTokenDecimals),
                                tokenPriceInUSD: "0", // TODO: Get from token details
                                transferAmountInUSD: "0", // TODO: Calculate with actual price
                                tokenAddress: resolvedTokenAddress.toLowerCase(),
                                tokenSymbol: resolvedTokenSymbol,
                                transferTransactionHash: txnReceipt.data,
                                tokenDecimals: resolvedTokenDecimals,
                                recipientAddress: resolvedRecipientAddress.toLowerCase(),
                                agentWalletAddress: agentWallet.address,
                                executionDateTime: new Date().toISOString(),
                                status: "SUCCESS",
                                verifiedDateTime: new Date().toISOString()
                            }
                        }
                    },
                    inputParams: {
                        baseParams: {
                            sellToken: {
                                symbol: resolvedTokenSymbol,
                                address: resolvedTokenAddress.toLowerCase()
                            },
                            buyAmount: Number(ethers.formatUnits(transferAmountInWEI, resolvedTokenDecimals)),
                            buyAmountValueType: BuyAmountValueType.TOKEN,
                            transferTo: resolvedRecipientAddress.toLowerCase()
                        }
                    },
                    source: SwapSource.AGENT_TOKEN_TRANSFER
                };

                await moxieUserService.addRuleExecutionLog(executionLogInput, process.env.MOXIE_API_KEY || "");
            }

            return {
                data: callBackTemplate.TRANSACTION_SUCCESSFUL(
                    txnReceipt.data,
                    ethers
                        .formatUnits(transferAmountInWEI, resolvedTokenDecimals)
                        .toString(),
                    resolvedTokenSymbol,
                    resolvedTokenAddress,
                    recipient
                ),
            };
        }
    } catch (error) {
        elizaLogger.error(
            context.traceId,
            `[tokenTransfer] [${context.moxieUserId}] [processSingleTransfer] Error: ${error}`
        );
        return {
            callBackTemplate: callBackTemplate.APPLICATION_ERROR(
                `Error processing transfer: ${error.message}`
            ),
        };
    }
}

/**
 * Resolves the recipient address by checking ENS name or getting Moxie user wallet
 * @param context - The context containing traceId and moxieUserId
 * @param recipient - The recipient identifier (address, ENS name, or Moxie user ID)
 * @returns The resolved recipient address or a callback template if resolution fails
 */
async function resolveRecipientAddress(
    context: Context,
    recipient: string
): Promise<FunctionResponse<string>> {
    if (!recipient) {
        elizaLogger.error(
            context.traceId,
            `[tokenTransfer] [${context.moxieUserId}] [resolveRecipientAddress] No recipient provided`
        );
        return {
            callBackTemplate: callBackTemplate.APPLICATION_ERROR(
                "Recipient is required"
            ),
        };
    }

    elizaLogger.debug(
        context.traceId,
        `[tokenTransfer] [${context.moxieUserId}] [resolveRecipientAddress] Resolving recipient: ${recipient}`
    );

    try {
        // First check if it's a valid Ethereum address since that's fastest
        if (ethers.isAddress(recipient)) {
            elizaLogger.debug(
                context.traceId,
                `[tokenTransfer] [${context.moxieUserId}] [resolveRecipientAddress] Valid Ethereum address: ${recipient}`
            );
            return {
                data: recipient,
            };
        }

        // Try to resolve as ENS
        const ensResult = await resolveENSAddress(context, recipient);
        if (ensResult.resolvedAddress) {
            elizaLogger.debug(
                context.traceId,
                `[tokenTransfer] [${context.moxieUserId}] [resolveRecipientAddress] Resolved ENS address: ${ensResult.resolvedAddress}`
            );
            return {
                data: ensResult.resolvedAddress,
            };
        }

        // Check if it's a creator coin as last resort since it's most expensive
        const creatorCoinResult = await processCreatorCoin(context, recipient);
        if (creatorCoinResult?.data) {
            elizaLogger.debug(
                context.traceId,
                `[tokenTransfer] [${context.moxieUserId}] [resolveRecipientAddress] Resolved creator coin: ${creatorCoinResult.data}`
            );
            return {
                data: creatorCoinResult.data,
            };
        }

        elizaLogger.error(
            context.traceId,
            `[tokenTransfer] [${context.moxieUserId}] [resolveRecipientAddress] Unable to resolve recipient: ${recipient}`
        );
        return {
            callBackTemplate: callBackTemplate.APPLICATION_ERROR(
                `Unable to resolve recipient address`
            ),
        };
    } catch (error) {
        elizaLogger.error(
            context.traceId,
            `[tokenTransfer] [${context.moxieUserId}] [resolveRecipientAddress] Error resolving recipient: ${error}`
        );
        return {
            callBackTemplate: callBackTemplate.APPLICATION_ERROR(
                "Failed to resolve recipient address"
            ),
        };
    }
}

/**
 * Checks if an address is an ENS name and resolves it
 * @param address - The address or ENS name to check and resolve
 * @returns The resolved address and ENS details if applicable
 */
async function resolveENSAddress(context: Context, address: string) {
    elizaLogger.debug(
        context.traceId,
        `[tokenTransfer] [resolveENSAddress] Checking address: ${address}`
    );

    const response = {
        isENS: false,
        resolvedAddress: null,
    };

    try {
        // Check if the address ends with .eth
        const isENS = address.toLowerCase().endsWith(".eth");

        if (!isENS) {
            return response;
        }

        const provider = new ethers.JsonRpcProvider(
            process.env.ETH_MAINNET_RPC_URL
        );

        // Try to resolve ENS name with retries and backoff
        let retries = 5;
        let delay = 1000; // Start with 1 second delay

        while (retries > 0) {
            try {
                const resolvedAddress = await provider.resolveName(address);

                if (resolvedAddress) {
                    response.isENS = true;
                    response.resolvedAddress = resolvedAddress;
                    return response;
                }

                // If no address resolved, try again after delay
                await new Promise((resolve) => setTimeout(resolve, delay));
                delay *= 2; // Double the delay for next retry
                retries--;
            } catch (error) {
                elizaLogger.error(
                    context.traceId,
                    `[tokenTransfer] [resolveENSAddress] Attempt ${6 - retries}/ 5 failed to resolve ENS name: ${address}`
                );
                if (retries === 1) {
                    return response;
                }
                await new Promise((resolve) => setTimeout(resolve, delay));
                delay *= 2;
                retries--;
            }
        }

        elizaLogger.error(
            context.traceId,
            `[tokenTransfer] [resolveENSAddress] Unable to resolve ENS name after retries: ${address}`
        );
        return response;
    } catch (error) {
        elizaLogger.error(
            context.traceId,
            `[tokenTransfer] [resolveENSAddress] Error resolving ENS: ${error}`
        );
        return response;
    }
}

/**
 * Processes a creator coin
 * @param moxieUserId - The ID of the Moxie user
 * @param recipient - The recipient of the creator coin
 * @returns A promise that resolves to a string or CallbackTemplate
 */
async function processCreatorCoin(
    context: Context,
    recipient: string
): Promise<FunctionResponse<string>> {
    try {
        // Extract creator details
        const {
            userId: recipientTokenCreatorId,
            username: recipientTokenCreatorUsername,
        } = extractCreatorDetails(recipient);
        elizaLogger.debug(
            context.traceId,
            `[tokenTransfer] [${context.moxieUserId}] [processCreatorCoin] recipientTokenCreatorId: ${recipientTokenCreatorId} and recipientTokenCreatorUsername: ${recipientTokenCreatorUsername}`
        );

        if (!recipientTokenCreatorId) {
            elizaLogger.debug(
                context.traceId,
                `[tokenTransfer] [${context.moxieUserId}] [processCreatorCoin] recipientTokenCreatorId not found`
            );
            return null;
        }
        // fetch the creator agent wallet address
        const moxieUserDetails =
            await agentLib.moxieUserService.getUserByMoxieId(
                recipientTokenCreatorId
            );
        elizaLogger.debug(
            context.traceId,
            `[tokenTransfer] [${context.moxieUserId}] [processCreatorCoin]  moxieUserDetails: ${JSON.stringify(moxieUserDetails)}`
        );

        if (!moxieUserDetails) {
            elizaLogger.debug(
                context.traceId,
                `[tokenTransfer] [${context.moxieUserId}] [processCreatorCoin] moxieUserDetails not found`
            );
            return null;
        }
        const creatorAgentWallet = moxieUserDetails.wallets.filter(
            (Wallet) => Wallet.walletType === "embedded"
        )[0];

        if (!creatorAgentWallet) {
            elizaLogger.debug(
                context.traceId,
                `[tokenTransfer] [${context.moxieUserId}] [processCreatorCoin] creatorAgentWallet not found`
            );
            return null;
        }

        return {
            data: creatorAgentWallet.walletAddress,
        };
    } catch (error) {
        elizaLogger.error(
            context.traceId,
            `[tokenTransfer] [${context.moxieUserId}] [processCreatorCoin] Error: ${error}`
        );
        return {
            callBackTemplate: callBackTemplate.APPLICATION_ERROR(
                "Error processing creator coin"
            ),
        };
    }
}

/**
 * Processes an ERC20 token
 * @param moxieUserId - The ID of the Moxie user
 * @param recipient - The recipient of the ERC20 token
 * @returns A promise that resolves to a string or CallbackTemplate
 */
async function processERC20(
    context: Context,
    recipient: string
): Promise<FunctionResponse<string>> {
    try {
        const { tokenSymbol, tokenAddress } = extractTokenDetails(recipient);
        elizaLogger.debug(
            context.traceId,
            `[tokenTransfer] [${context.moxieUserId}] [processERC20] tokenSymbol: ${tokenSymbol} and tokenAddress: ${tokenAddress}`
        );

        // fetch the token details
        if (!tokenSymbol || !tokenAddress) {
            elizaLogger.error(
                context.traceId,
                `[tokenTransfer] [${context.moxieUserId}] [processERC20] Invalid token details: ${recipient}`
            );
            return {
                callBackTemplate: callBackTemplate.APPLICATION_ERROR(
                    "Invalid token details"
                ),
            };
        }

        return {
            data: tokenAddress,
        };
    } catch (error) {
        elizaLogger.error(
            context.traceId,
            `[tokenTransfer] [${context.moxieUserId}] [processERC20] Error: ${error}`
        );
        return {
            callBackTemplate: callBackTemplate.APPLICATION_ERROR(
                "Error processing ERC20"
            ),
        };
    }
}

/**
 * Extracts creator details from a token string
 * @param token - The token string to extract details from
 * @returns An object containing the username and userId if found, or null if no match is found
 */
export function extractCreatorDetails(
    token: string
): { username: string; userId: string } | null {
    const regex = /@\[([^|]+)\|([^\]]+)\]/;
    const match = token.match(regex);

    if (!match) {
        return {
            username: null,
            userId: null,
        };
    }

    return {
        username: match[1],
        userId: match[2],
    };
}

/**
 * Extracts token details from a token string
 * @param token - The token string to extract details from
 * @returns An object containing the token symbol and address if found, or null if no match is found
 */
export function extractTokenDetails(
    token: string
): { tokenSymbol: string; tokenAddress: string } | null {
    const regex = /\$\[([^|]+)\|([^\]]+)\]/;
    const match = token.match(regex);

    if (!match) {
        return {
            tokenSymbol: null,
            tokenAddress: null,
        };
    }

    return {
        tokenSymbol: match[1],
        tokenAddress: match[2],
    };
}

/**
 * Fetches FTA responses for given creator IDs
 * @param context - The context of the transaction
 * @param creatorIds - Array of creator IDs
 * @returns A promise that resolves to a record of FTA responses
 */
async function getFtaResponses(
    context: Context,
    creatorIds: string[]
): Promise<FunctionResponse<Record<string, any>>> {
    // Input validation
    if (!creatorIds?.length) {
        elizaLogger.error(
            context.traceId,
            `[tokenTransfer] [${context.moxieUserId}] [getFtaResponses] No creator IDs provided`
        );
        return {
            callBackTemplate: callBackTemplate.APPLICATION_ERROR(
                "No creator IDs provided"
            ),
        };
    }

    const ftaResponses: Record<string, any> = {};

    // Process creators in parallel for better performance
    const results = await Promise.all(
        creatorIds.map(async (creatorId) => {
            const cacheKey = `userftadetails-${creatorId}`;

            try {
                // Check cache first
                const cachedResponse =
                    await context.runtime.cacheManager.get(cacheKey);
                if (cachedResponse) {
                    elizaLogger.debug(
                        context.traceId,
                        `[tokenTransfer] [${context.moxieUserId}] [getFtaResponses] Cache hit for creator ${creatorId}`
                    );
                    return { creatorId, response: cachedResponse };
                }

                // Fetch fresh data if not in cache
                const newResponse =
                    await agentLib.ftaService.getUserFtaData(creatorId);
                if (!newResponse) {
                    elizaLogger.error(
                        context.traceId,
                        `[tokenTransfer] [${context.moxieUserId}] [getFtaResponses] Creator ${creatorId} not found`
                    );
                    return { error: true, creatorId };
                }

                // Cache the new response
                await context.runtime.cacheManager.set(cacheKey, newResponse);
                elizaLogger.debug(
                    context.traceId,
                    `[tokenTransfer] [${context.moxieUserId}] [getFtaResponses] Cached new data for creator ${creatorId}`
                );
                return { creatorId, response: newResponse };
            } catch (error) {
                elizaLogger.error(
                    context.traceId,
                    `[tokenTransfer] [${context.moxieUserId}] [getFtaResponses] Error processing creator ${creatorId}: ${error}`
                );
                return { error: true, creatorId };
            }
        })
    );

    // Process results
    for (const result of results) {
        if (result.error) {
            return {
                callBackTemplate: callBackTemplate.CREATOR_NOT_FOUND(
                    result.creatorId
                ),
            };
        }
        ftaResponses[result.creatorId] = result.response;
    }

    return {
        data: ftaResponses,
    };
}

/**
 * Resolves a token identifier to its on-chain details
 * @param context - The context of the transaction
 * @param token - The token identifier (can be creator coin, token:address format, or address)
 * @returns A promise that resolves to token details or an error callback
 */
async function resolveTokenAddress(
    context: Context,
    token: string
): Promise<FunctionResponse<TokenDetails>> {
    elizaLogger.debug(
        context.traceId,
        `[tokenTransfer] [${context.moxieUserId}] [resolveTokenAddress] Resolving token: ${token}`
    );
    try {
        // First check if it's a creator coin
        const subjectTokenDetails = await getCreatorCoinDetails(context, token);

        if (subjectTokenDetails.callBackTemplate) {
            return {
                callBackTemplate: subjectTokenDetails.callBackTemplate,
            };
        }

        if (subjectTokenDetails.data) {
            return {
                data: {
                    tokenAddress: subjectTokenDetails.data.id,
                    tokenSymbol: subjectTokenDetails.data.symbol,
                    tokenDecimals: Number(subjectTokenDetails.data.decimals),
                    tokenType: "CREATOR_COIN",
                    currentMoxiePriceInWEI:
                        subjectTokenDetails.data.currentPriceInWeiInMoxie,
                },
            };
        }

        let tokenSymbol: string;
        let tokenAddress: string;
        // Check if token is a valid Ethereum address
        if (ethers.isAddress(token)) {
            try {
                // Token is a valid address, fetch symbol from JSON RPC
                tokenSymbol = await getERC20TokenSymbol(token);
                tokenAddress = token;
                elizaLogger.debug(
                    context.traceId,
                    `[tokenTransfer] [${context.moxieUserId}] [resolveTokenAddress] Token details: ${JSON.stringify(
                        {
                            tokenAddress: tokenAddress,
                            tokenSymbol: tokenSymbol,
                            tokenType: "ERC20",
                        }
                    )}`
                );
            } catch (error) {
                elizaLogger.error(
                    context.traceId,
                    `[tokenTransfer] [${context.moxieUserId}] [resolveTokenAddress] Error fetching token symbol: ${error}`
                );
                return {
                    callBackTemplate: callBackTemplate.APPLICATION_ERROR(
                        "Error fetching token symbol"
                    ),
                };
            }
        } else {
            // Not a valid address, try to extract from token:address format
            ({ tokenAddress, tokenSymbol } = extractTokenDetails(token));
            if (!tokenAddress || !ethers.isAddress(tokenAddress)) {
                elizaLogger.error(
                    context.traceId,
                    `[tokenTransfer] [${context.moxieUserId}] [resolveTokenAddress] Invalid token format: ${token}`
                );
                return {
                    callBackTemplate: callBackTemplate.APPLICATION_ERROR(
                        "Invalid token format"
                    ),
                };
            }
        }

        elizaLogger.debug(
            context.traceId,
            `[tokenTransfer] [${context.moxieUserId}] [resolveTokenAddress] Extracted ERC20 address: ${tokenAddress}`
        );

        const tokenDecimals =
            tokenAddress.toLowerCase() === ETH_ADDRESS.toLowerCase()
                ? 18
                : await getERC20Decimals(context, tokenAddress);
        elizaLogger.debug(
            context.traceId,
            `[tokenTransfer] [${context.moxieUserId}] [resolveTokenAddress] Token decimals: ${tokenDecimals}`
        );

        return {
            data: {
                tokenAddress,
                tokenSymbol,
                tokenDecimals: Number(tokenDecimals),
                tokenType: "ERC20",
            },
        };
    } catch (error) {
        elizaLogger.error(
            context.traceId,
            `[tokenTransfer] [${context.moxieUserId}] [resolveTokenAddress] Error: ${error}`
        );
        return {
            callBackTemplate: callBackTemplate.APPLICATION_ERROR(
                "Error resolving token address"
            ),
        };
    }
}

/**
 * Get the creator coin details
 * @param tokenAddress - The address of the token
 * @param moxieUserId - The ID of the Moxie user
 * @param runtime - The runtime environment
 * @returns A promise that resolves to a SubjectToken or CallbackTemplate
 */
async function getCreatorCoinDetails(
    context: Context,
    tokenAddress: string
): Promise<FunctionResponse<SubjectToken>> {
    let subjectTokenDetails: SubjectToken;

    // extract the creator details
    const { userId: tokenCreatorId, username: tokenCreatorUsername } =
        extractCreatorDetails(tokenAddress);

    // If we need to fetch any FTA details
    if (tokenCreatorId) {
        try {
            const ftaResponses = await getFtaResponses(context, [
                tokenCreatorId,
            ]);
            if (ftaResponses.callBackTemplate) {
                return {
                    callBackTemplate: ftaResponses.callBackTemplate,
                };
            }
            const tokenSubjectAddress =
                ftaResponses.data[tokenCreatorId]?.subjectAddress;
            subjectTokenDetails = await getSubjectTokenDetailsBySubjectAddress(
                context.traceId,
                tokenSubjectAddress
            );
        } catch (error) {
            elizaLogger.error(
                context.traceId,
                `[tokenTransfer] [${context.moxieUserId}] [getCreatorCoinDetails] Error getting FTA responses for creator ID ${tokenCreatorId}: ${error}`
            );
            return {
                callBackTemplate: callBackTemplate.APPLICATION_ERROR(
                    "Error getting FTA responses for creator ID"
                ),
            };
        }
    }

    return {
        data: subjectTokenDetails,
    };
}

/**
 * Executes a transfer of ERC20 tokens
 * @param traceId - The trace ID of the message
 * @param moxieUserId - The ID of the Moxie user
 * @param tokenAddress - The address of the token
 * @param recipientAddress - The address of the recipient
 * @param agentWallet - The address of the agent's wallet
 * @param amountInWEI - The amount of tokens to transfer
 * @returns A promise that resolves to a FunctionResponse<TransactionResponse>
 */
async function executeTransfer(
    context: Context,
    tokenAddress: string,
    recipientAddress: string,
    agentWallet: string,
    amountInWEI: bigint
): Promise<FunctionResponse<string>> {
    elizaLogger.debug(
        context.traceId,
        `[tokenTransfer] [${context.moxieUserId}] [executeTransfer] Executing transfer of ${amountInWEI} tokens from ${agentWallet} to ${recipientAddress}`
    );

    const feeData = await context.provider.getFeeData();
    elizaLogger.debug(
        context.traceId,
        `[tokenTransfer] [${context.moxieUserId}] [executeTransfer] feeData: ${JSON.stringify(feeData)}`
    );

    // Add 20% buffer to gas fees
    const maxPriorityFeePerGas =
        (feeData.maxPriorityFeePerGas! * BigInt(120)) / BigInt(100);
    const maxFeePerGas = (feeData.maxFeePerGas! * BigInt(120)) / BigInt(100);
    elizaLogger.debug(
        context.traceId,
        `[tokenTransfer] [${context.moxieUserId}] [executeTransfer] maxPriorityFeePerGas: ${maxPriorityFeePerGas} maxFeePerGas: ${maxFeePerGas}`
    );

    // Prepare transaction input for ERC20 token transfer
    const isEthTransfer =
        tokenAddress.toLowerCase() === ETH_ADDRESS.toLowerCase();
    const request: agentLib.TransactionDetails = {
        fromAddress: agentWallet,
        toAddress: isEthTransfer ? recipientAddress : tokenAddress,
        value: isEthTransfer ? Number(amountInWEI) : 0,
        data: isEthTransfer
            ? undefined
            : encodeFunctionData({
                  abi: ERC20_ABI,
                  functionName: "transfer",
                  args: [recipientAddress, amountInWEI],
              }),
        maxFeePerGas: Number(maxFeePerGas),
        maxPriorityFeePerGas: Number(maxPriorityFeePerGas),
    };
    elizaLogger.debug(
        context.traceId,
        `[tokenTransfer] [${context.moxieUserId}] [executeTransfer] request: ${JSON.stringify(request)}`
    );

    // Send the transaction
    const walletClient = context.state
        .moxieWalletClient as agentLib.MoxieWalletClient;
    let transactionResponse: agentLib.MoxieWalletSendTransactionResponseType;
    const MAX_RETRIES = 3;
    let retryCount = 0;
    let lastError: any;

    while (retryCount < MAX_RETRIES) {
        try {
            elizaLogger.debug(
                context.traceId,
                `[tokenTransfer] [${context.moxieUserId}] [executeTransfer] Attempt ${retryCount + 1} of ${MAX_RETRIES}`
            );
            transactionResponse = await walletClient.sendTransaction(
                process.env.CHAIN_ID || "8453",
                request
            );
            break; // Success, exit the retry loop
        } catch (error) {
            lastError = error;
            retryCount++;
            elizaLogger.warn(
                context.traceId,
                `[tokenTransfer] [${context.moxieUserId}] [executeTransfer] Error sending transaction (attempt ${retryCount}): ${error}`
            );

            if (retryCount < MAX_RETRIES) {
                // Wait before retrying (exponential backoff)
                const delay = 1000 * Math.pow(2, retryCount);
                elizaLogger.debug(
                    context.traceId,
                    `[tokenTransfer] [${context.moxieUserId}] [executeTransfer] Retrying in ${delay}ms...`
                );
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
        }
    }

    if (retryCount === MAX_RETRIES) {
        elizaLogger.error(
            context.traceId,
            `[tokenTransfer] [${context.moxieUserId}] [executeTransfer] Failed after ${MAX_RETRIES} attempts: ${lastError}`
        );

        // Check if the error is related to insufficient funds
        if (
            lastError &&
            lastError.message &&
            lastError.message.includes(
                "insufficient funds for gas * price + value"
            )
        ) {
            return {
                callBackTemplate:
                    callBackTemplate.TRANSACTION_SUBMISSION_FAILED(
                        "Insufficient funds to cover gas costs for this transaction"
                    ),
            };
        }

        return {
            callBackTemplate: callBackTemplate.TRANSACTION_SUBMISSION_FAILED(),
        };
    }

    elizaLogger.debug(
        context.traceId,
        `[tokenTransfer] [${context.moxieUserId}] [executeTransfer] transactionResponse: ${JSON.stringify(transactionResponse)}`
    );

    return {
        data: transactionResponse.hash,
    };
}

/**
 * Get the current wallet balance and calculate transfer amount based on percentage
 * @param context The context object containing traceId and moxieUserId
 * @param currentWalletBalance Optional pre-fetched wallet balance to avoid duplicate queries
 * @param tokenAddress The token contract address
 * @param tokenSymbol The token symbol (e.g. "ETH")
 * @param agentWallet The wallet to check balance for
 * @param balance The balance object containing percentage to transfer
 * @returns Promise resolving to the calculated transfer amount in WEI
 */
async function getTargetQuantityForBalanceBasedTokenTransfer(
    context: Context,
    currentWalletBalance: bigint | undefined,
    tokenAddress: string,
    tokenSymbol: string,
    agentWallet: agentLib.MoxieClientWallet,
    balance: Balance
): Promise<FunctionResponse<bigint>> {
    // Input validation
    if (!tokenAddress || !tokenSymbol || !agentWallet || !balance) {
        elizaLogger.error(
            context.traceId,
            `[tokenTransfer] [${context.moxieUserId}] [getTargetQuantityForBalanceBasedTokenTransfer] Missing required parameters`
        );
        return {
            callBackTemplate: callBackTemplate.APPLICATION_ERROR(
                "Missing required parameters for balance based token transfer"
            ),
        };
    }

    if (
        !balance.percentage ||
        balance.percentage <= 0 ||
        balance.percentage > 100
    ) {
        elizaLogger.error(
            context.traceId,
            `[tokenTransfer] [${context.moxieUserId}] [getTargetQuantityForBalanceBasedTokenTransfer] Invalid percentage: ${balance.percentage}`
        );
        return {
            callBackTemplate: callBackTemplate.APPLICATION_ERROR(
                "Invalid percentage value for balance based token transfer"
            ),
        };
    }

    elizaLogger.debug(
        context.traceId,
        `[tokenTransfer] [${context.moxieUserId}] [getTargetQuantityForBalanceBasedTokenTransfer] Processing transfer with: token=${tokenSymbol}, percentage=${balance.percentage}%`
    );

    try {
        // Get current balance if not provided
        let walletBalance = currentWalletBalance;
        if (!walletBalance) {
            const balanceStr =
                tokenSymbol.toUpperCase() === "ETH"
                    ? await getNativeTokenBalance(agentWallet.address)
                    : await getERC20Balance(tokenAddress, agentWallet.address);
            walletBalance = BigInt(balanceStr);
        }

        elizaLogger.debug(
            context.traceId,
            `[tokenTransfer] [${context.moxieUserId}] [getTargetQuantityForBalanceBasedTokenTransfer] Current balance: ${walletBalance}`
        );

        if (!walletBalance) {
            elizaLogger.error(
                context.traceId,
                `[tokenTransfer] [${context.moxieUserId}] [getTargetQuantityForBalanceBasedTokenTransfer] Insufficient balance for ${tokenSymbol}`
            );
            return {
                callBackTemplate: callBackTemplate.APPLICATION_ERROR(
                    "error getting wallet balance"
                ),
            };
        }

        // Calculate transfer amount based on percentage
        // Using 1e9 as base to maintain precision while avoiding overflow
        const percentageBase = 1e9;
        // If ETH and 100%, use 99% instead to leave gas for transaction
        const adjustedPercentage =
            tokenSymbol.toUpperCase() === "ETH" && balance.percentage === 100
                ? 99
                : balance.percentage;
        elizaLogger.debug(
            context.traceId,
            `[tokenTransfer] [${context.moxieUserId}] [getTargetQuantityForBalanceBasedTokenTransfer] Original percentage: ${balance.percentage}, Adjusted percentage: ${adjustedPercentage}`
        );
        const scaledPercentage = adjustedPercentage * 1e7; // Scale up by 1e7 to maintain precision
        const quantityInWEI =
            (walletBalance * BigInt(scaledPercentage)) / BigInt(percentageBase);

        elizaLogger.debug(
            context.traceId,
            `[tokenTransfer] [${context.moxieUserId}] [getTargetQuantityForBalanceBasedTokenTransfer] Calculated amount: ${quantityInWEI}`
        );

        return {
            data: quantityInWEI,
        };
    } catch (error) {
        elizaLogger.error(
            context.traceId,
            `[tokenTransfer] [${context.moxieUserId}] [getTargetQuantityForBalanceBasedTokenTransfer] Error: ${error}`
        );
        return {
            callBackTemplate: callBackTemplate.APPLICATION_ERROR(
                "Failed to calculate transfer amount"
            ),
        };
    }
}

/**
 * Convert a USD value to a token amount
 * @param context - The context of the transaction
 * @param transferAmount - The amount to transfer in USD
 * @param tokenAddress - The address of the token to transfer
 * @param tokenDecimals - The number of decimals of the token
 * @param tokenType - The type of token (CREATOR_COIN or ERC20)
 * @param currentMoxiePriceInWEI - Current price of Moxie token in WEI (only used for CREATOR_COIN)
 * @returns Promise resolving to token amount in WEI or error
 */
async function convertUSDToTokenAmount(
    context: Context,
    transferAmount: bigint,
    tokenAddress: string,
    tokenDecimals: number,
    tokenType: string,
    currentMoxiePriceInWEI: string
): Promise<FunctionResponse<bigint>> {
    elizaLogger.debug(
        context.traceId,
        `[tokenTransfer] [${context.moxieUserId}] [convertUSDToTokenAmount] Converting USD amount: ${transferAmount} to ${tokenAddress}`
    );

    try {
        // Convert USD amount to USDC with proper decimals
        const transferAmountInUSDCWEI = ethers.parseUnits(
            transferAmount.toString(),
            USDC_TOKEN_DECIMALS
        );

        // Handle USDC transfers directly
        if (tokenAddress === USDC_ADDRESS) {
            return { data: transferAmountInUSDCWEI };
        }

        // get the equivalent price using codex api
        // if ETH , we need use WETH price. since codex does not support native ETH
        let tokenAddressForCodex = tokenAddress;
        if (tokenAddress.toLowerCase() === ETH_ADDRESS.toLowerCase()) {
            tokenAddressForCodex = WETH_ADDRESS;
        }

        const tokenWithNetworkId = `${tokenAddressForCodex}:${BASE_NETWORK_ID}`;
        const tokenDetails = await agentLib.getTokenDetails([
            tokenWithNetworkId,
        ]);
        elizaLogger.debug(
            context.traceId,
            `[tokenTransfer] [${context.moxieUserId}] [convertUSDToTokenAmount] Token details Response: ${JSON.stringify(tokenDetails)}`
        );

        if (!tokenDetails || tokenDetails.length === 0) {
            elizaLogger.error(
                context.traceId,
                `[tokenTransfer] [${context.moxieUserId}] [convertUSDToTokenAmount] Error getting token details: ${tokenDetails}`
            );
            return {
                callBackTemplate: callBackTemplate.APPLICATION_ERROR(
                    "Failed to get token details from codex "
                ),
            };
        }

        const tokenDetail = tokenDetails[0];
        if (!tokenDetail?.priceUSD) {
            elizaLogger.error(
                context.traceId,
                `[tokenTransfer] [${context.moxieUserId}] [convertUSDToTokenAmount] Error getting token details from getTokenDetails: ${tokenDetail}`
            );
            return {
                callBackTemplate: callBackTemplate.APPLICATION_ERROR(
                    "Failed to get token details priceUSD "
                ),
            };
        }

        const priceUSD = Decimal(tokenDetail.priceUSD);
        elizaLogger.debug(
            context.traceId,
            `[tokenTransfer] [${context.moxieUserId}] [convertUSDToTokenAmount] Price USD: ${priceUSD}`
        );

        // Calculate token amount by dividing USD amount by price per token
        const tokenAmount = Decimal(transferAmount.toString())
            .div(priceUSD)
            .toFixed(tokenDecimals);
        elizaLogger.debug(
            context.traceId,
            `[tokenTransfer] [${context.moxieUserId}] [convertUSDToTokenAmount] Calculated ${tokenAmount}`
        );

        // Parse with appropriate decimals
        const tokenAmountInWei = ethers.parseUnits(
            tokenAmount.toString(),
            tokenDecimals
        );

        elizaLogger.debug(
            context.traceId,
            `[tokenTransfer] [${context.moxieUserId}] [convertUSDToTokenAmount] Token amount in WEI: ${tokenAmountInWei}`
        );

        // For creator coins, need to convert Moxie amount to creator coin amount
        if (tokenType === "CREATOR_COIN") {
            const moxiePrice = new Decimal(currentMoxiePriceInWEI);
            if (moxiePrice.isZero()) {
                throw new Error("Invalid Moxie token price");
            }

            const creatorCoinAmount = new Decimal(tokenAmountInWei.toString())
                .div(moxiePrice)
                .toFixed(MOXIE_TOKEN_DECIMALS, Decimal.ROUND_DOWN)
                .replace(/\.?0+$/, "");

            return {
                data: ethers.parseUnits(
                    creatorCoinAmount,
                    MOXIE_TOKEN_DECIMALS
                ),
            };
        }

        // For regular ERC20 tokens, return the token amount directly
        return {
            data: tokenAmountInWei,
        };
    } catch (error) {
        elizaLogger.error(
            context.traceId,
            `[tokenTransfer] [${context.moxieUserId}] [convertUSDToTokenAmount] Error: ${error}`
        );
        return {
            callBackTemplate: callBackTemplate.APPLICATION_ERROR(
                "Failed to convert USD amount to tokens"
            ),
        };
    }
}
