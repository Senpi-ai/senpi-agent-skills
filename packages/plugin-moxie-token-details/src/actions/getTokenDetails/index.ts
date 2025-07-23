import {
    composeContext,
    elizaLogger,
    streamText,
    HandlerCallback,
    IAgentRuntime,
    ModelClass,
    Memory,
    State,
    type Action,
} from "@moxie-protocol/core";
import { tokenDetailsExamples } from "./examples";
import { getTokenDetails, TokenDetails } from "@moxie-protocol/moxie-agent-lib";
import { tokenDetailsSummary } from "./template";
import { TOP_MEMORY_CONVERSATIONS } from "../../config";

export default {
    name: "TOKEN_DETAILS",
    similes: [
        "TOKEN_DETAILS_SUMMARY",
        "BASE_TOKEN_DETAIL",
        "BASE_TOKEN_DETAILS",
        "BASE_TOKEN_DETAILS_SUMMARY",
        "TOKEN_SUMMARY",
        "ERC20_DETAILS",
        "ERC20_DETAILS_SUMMARY",
        "ERC20_TOKEN_DETAILS",
        "ERC20_TOKEN_DETAILS_SUMMARY",
        "TOKEN_INFO",
        "TOKEN_PORTFOLIO",
        "TOKEN_PRICE",
        "TOKEN_MARKET_CAP",
        "TOKEN_HOLDINGS",
        "TOKEN_LIQUIDITY",
        "TOKEN_MARKET_PERFORMANCE",
        "TOKEN_MARKET_SENTIMENT",
    ],
    suppressInitialMessage: true,
    validate: async (runtime: IAgentRuntime, message: Memory) => {
        elizaLogger.log("[TOKEN_DETAILS] Validating request");
        const codexApiKey = process.env.CODEX_API_KEY;
        if (!codexApiKey) {
            elizaLogger.error("[TOKEN_DETAILS] CODEX_API_KEY is not set");
            return false;
        }
        return true;
    },
    description:
        "Fetches detailed insights on ERC20 tokens (excluding creator coins), including price, market cap, liquidity, trading activity, and volume fluctuations.",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: { [key: string]: unknown },
        callback?: HandlerCallback
    ): Promise<boolean> => {
        elizaLogger.log("[TOKEN_DETAILS] Starting portfolio fetch");

        const memoryObj = await runtime.messageManager.getMemories({
            roomId: message.roomId,
            count: TOP_MEMORY_CONVERSATIONS,
            unique: true,
        });

        const formattedHistory = memoryObj.map((memory) => {
            const role =
                memory.userId === runtime.agentId ? "Assistant" : "User";
            return `${role}: ${memory.content.text}`;
        });
        const memoryContents = formattedHistory.reverse().slice(-12);

        elizaLogger.success(
            `Memory contents: ${JSON.stringify(memoryContents)}`
        );

        // Extract Ethereum/Base addresses from message
        const addresses =
            message.content.text.match(/0x[a-fA-F0-9]{40}/g) || [];

        if (addresses.length === 0 && memoryContents.length <= 1) {
            await callback({
                text: "Please provide the base address of the token you want to know more about",
            });
            return false;
        }

        // Convert addresses to lowercase and append chain ID
        const formattedAddresses = addresses.map((addr) => addr.toLowerCase());

        elizaLogger.log("[TOKEN_DETAILS] Checking cache for token details");

        let tokenDetails: TokenDetails[] = [];
        let tokenDetailsToFetch = [];

        // Only fetch details for addresses not in cache
        if (formattedAddresses.length > 0) {
            elizaLogger.log("[TOKEN_DETAILS] Fetching fresh token details");
            tokenDetails = await getTokenDetails(formattedAddresses);
        }

        if (
            (!tokenDetails || tokenDetails.length === 0) &&
            memoryContents.length <= 1
        ) {
            await callback({
                text: "I couldn't find any token details for the provided addresses",
                action: "TOKEN_DETAILS_ERROR",
            });
            return false;
        }

        elizaLogger.success(
            "[TOKEN_DETAILS] Successfully fetched token details"
        );

        const newstate = await runtime.composeState(message, {
            tokenDetails: JSON.stringify(tokenDetails),
            question: message.content.text,
            memory: memoryContents.length > 1 ? memoryContents : "",
        });

        const context = composeContext({
            state: newstate,
            template: tokenDetailsSummary,
        });

        const summary = streamText({
            runtime,
            context,
            modelClass: ModelClass.MEDIUM,
        });

        for await (const textPart of summary) {
            callback({ text: textPart, action: "TOKEN_DETAILS" });
        }

        elizaLogger.success(
            "[TOKEN_DETAILS] Successfully generated token details summary"
        );

        return true;
    },
    examples: tokenDetailsExamples,
    template: tokenDetailsSummary,
} as Action;
