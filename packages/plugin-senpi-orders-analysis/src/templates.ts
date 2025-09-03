export const senpiOrdersAnalysisTemplate = `
Extract the following details to analyze the senpi orders by using the following guidelines:
1. Determine if the user is asking for analysis or recommendation.
    If no specific user or group is mentioned, assume the user is asking for analysis of their own trades.
Provide the values in the following JSON format:

\`\`\`json
{
    "analysisType": "USER" | "GROUP",
    "days": number,
    "userOrGroupId?": string,
    "userOrGroupName?": string,
    "orderBy": "AVG_PNL" | "TOTAL_PNL" | "WIN_RATE" | "TRADE_COUNT",
}
\`\`\`

Here are example requests and their corresponding responses:

Here are the recent user messages for context:
{{recentMessages}}
`;

export const analysisOrRecommendTemplate = ``;
