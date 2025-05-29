// Import required dependencies and types
import {
    composeContext,
    elizaLogger,
    streamText,
    HandlerCallback,
    IAgentRuntime,
    Memory,
    ModelClass,
    State,
    type Action,
    generateObjectDeprecated,
    ModelProviderName,
} from "@moxie-protocol/core";
import { MoxieUser, getTokenDetails } from "@moxie-protocol/moxie-agent-lib";
import { twitterScraperService } from "../../services/twitterService";
import { getFarcasterCasts } from "../../services/neynarService";
import {
    socialPlatformDetectionTemplate,
    tokenSocialSentimentTemplateV2,
} from "./template";

// Export the action configuration
export default {
    name: "TOKEN_SOCIAL_SENTIMENT",
    similes: [
        "SOCIAL_SENTIMENT",
        "TWITTER_TOKEN",
        "TWITTER_TOKEN_SENTIMENT",
        "TWITTER_TWEETS_SENTIMENT",
        "TWITTER_TOKEN_SOCIAL_SENTIMENT",
        "RECENT_TWEETS_INFO",
        "RECENT_TWEETS_SENTIMENT",
        "RECENT_TWEETS_SENTIMENT_SUMMARY",
        "TOKEN_TWEETS",
        "TOKEN_TWEETS_INFO",
        "TOKEN_TWEETS_SENTIMENT",
        "CRYPTO_TWITTER_SENTIMENT",
        "CASHTAG_SENTIMENT",
        "$TICKER_SENTIMENT",
        "SOCIAL_SENTIMENT_TWITTER",
        "SOCIAL_SENTIMENT_FARCASTER",
    ],
    suppressInitialMessage: true,
    validate: async (runtime: IAgentRuntime, message: Memory) => {
        elizaLogger.log("[TokenSocialSentiment] Validating request");
        return true;
    },
    description:
        "Analyzes ERC20 token on Base sentiment and news on Social Platforms (X and Farcaster). Use this when the user is asking about what people are talking about the token. Input can be token symbol (e.g.$[MOXIE|address]), contract address or token name.",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: { [key: string]: unknown },
        callback?: HandlerCallback
    ): Promise<boolean> => {
        const traceId = message.id;
        elizaLogger.debug(
            traceId,
            "[TokenSocialSentiment] Starting SocialSentiment fetch"
        );

        try {
            await twitterScraperService.initialize();
            elizaLogger.debug(
                traceId,
                `[TokenSocialSentiment] message context text: ${message.content.text}`
            );

            const latestMessage = message.content.text;

            const socialPlatformDetectionTemplateWithLatestMessage =
                socialPlatformDetectionTemplate.replace(
                    "{{latestMessage}}",
                    latestMessage
                );

            const socialPlatformDetectionContext = composeContext({
                state,
                template: socialPlatformDetectionTemplateWithLatestMessage,
            });

            const socialPlatformDetectionResponse =
                await generateObjectDeprecated({
                    runtime,
                    context: socialPlatformDetectionContext,
                    modelClass: ModelClass.SMALL,
                });

            const { socialPlatform, tokenSymbol } =
                socialPlatformDetectionResponse;
            elizaLogger.debug(
                traceId,
                `[SocialPlatform] social platform: ${socialPlatform} token symbol: ${tokenSymbol}`
            );

            const moxieUserId = (state.moxieUserInfo as MoxieUser)?.id;
            const tokenAddress =
                message.content.text.match(/0x[a-fA-F0-9]{40}/g) || [];
            let tokenTicker: string | RegExpMatchArray | [] =
                message.content.text.match(/(?<=\$\[)[^|]+(?=\|)/) || [];

            elizaLogger.debug(
                traceId,
                `[TokenSocialSentiment]token symbol: ${tokenSymbol}`
            );
            elizaLogger.debug(
                traceId,
                `[TokenSocialSentiment]token ticker: ${tokenTicker}`
            );
            elizaLogger.debug(
                traceId,
                `[TokenSocialSentiment]token address: ${tokenAddress}`
            );

            if (
                tokenAddress.length > 0 &&
                (!tokenTicker ||
                    (Array.isArray(tokenTicker) && tokenTicker.length === 0))
            ) {
                elizaLogger.debug(
                    traceId,
                    "[TokenSocialSentiment]Found address but no ticker, fetching token details"
                );
                const tokenDetails = await getTokenDetails([tokenAddress[0]]);

                if (!tokenDetails) {
                    callback({
                        text: "Please provide a valid token address or ticker symbol",
                        action: "TOKEN_SOCIAL_SENTIMENT",
                    });
                    return false;
                }
                tokenTicker = tokenDetails[0].tokenSymbol;
            } else if (
                tokenSymbol &&
                (!tokenTicker ||
                    (Array.isArray(tokenTicker) && tokenTicker.length === 0))
            ) {
                tokenTicker = tokenSymbol;
            }

            const formattedSymbol = (
                Array.isArray(tokenTicker) ? tokenTicker[0] : tokenTicker
            )
                .toString()
                .toLowerCase();

            let farcasterCasts: any[] = [];
            let tweets: any[] = [];
            // Get the farcaster casts and twitter posts
            if (socialPlatform.includes("farcaster")) {
                farcasterCasts = await getFarcasterCasts(
                    formattedSymbol,
                    runtime,
                    traceId
                );
                elizaLogger.debug(
                    traceId,
                    `[TokenSocialSentiment]farcaster casts: ${JSON.stringify(farcasterCasts)}`
                );
            }
            if (socialPlatform.includes("twitter")) {
                tweets = await twitterScraperService.getTweetsBySearchQuery(
                    formattedSymbol,
                    100,
                    traceId
                );
                elizaLogger.debug(
                    traceId,
                    `[Twitter] tweets: ${JSON.stringify(tweets)}`
                );
            }

            const stateWithLatestMessage = tokenSocialSentimentTemplateV2
                .replace("{{tweets}}", JSON.stringify(tweets))
                .replace("{{farcasterCasts}}", JSON.stringify(farcasterCasts))
                .replace("{{currentDate}}", new Date().toISOString())
                .replace("{{tokenSymbol}}", tokenSymbol)
                .replace("{{tokenAddress}}", tokenAddress[0]);

            const currentContext = composeContext({
                state,
                template: stateWithLatestMessage,
            });

            const response = await streamText({
                runtime,
                context: currentContext,
                modelClass: ModelClass.MEDIUM,
                modelConfigOptions: {
                    modelProvider: ModelProviderName.OPENAI,
                    temperature: 0.5,
                    apiKey: process.env.OPENAI_API_KEY!,
                    modelClass: ModelClass.MEDIUM,
                },
            });

            for await (const textPart of response) {
                callback({ text: textPart, action: "TOKEN_SOCIAL_SENTIMENT" });
            }

            return true;
        } catch (error) {
            elizaLogger.error(
                traceId,
                "[TokenSocialSentiment] Error fetching token social sentiment:",
                error,
                error?.stack
            );

            if (callback) {
                await callback({
                    text: "There is some problem while fetching the token social sentiment. Please try again later.",
                    content: { error: error.message },
                    action: "TOKEN_SOCIAL_SENTIMENT",
                });
            }
            return false;
        }
    },
    examples: [],
    template: tokenSocialSentimentTemplateV2,
} as Action;
