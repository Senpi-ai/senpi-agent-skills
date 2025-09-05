export const senpiOrdersAnalysisTemplate = `
You are an AI assistant. Your task is to take the conversation history and other context given and output only a JSON object in the following format:

\`\`\`json
{
  "data": {
    "analysisType": "USER" | "GROUP",
    "days": number,
    "userOrGroupId": string | null,
    "orderBy": "AVG_PNL" | "TOTAL_PNL" | "WIN_RATE" | "TRADE_COUNT"
  },
  "error": {
    "prompt_message": string
  } | null
}
\`\`\`

## Rules

1. Defaults
   - If no time period is given → "days": 7.
   - If no sorting preference is given → "orderBy": "TOTAL_PNL".
2. Scope Detection
   - If the request is about groups (mentions group(s) or uses #[] tag) → "analysisType": "GROUP".
   - Otherwise default to "USER".
3. Tag Extraction
   - User tag format: @[userName|userId] → take the userId.
   - Group tag format: #[groupName|groupId] → take the groupId.
4. Identity Check
   - If a user tag is present and the userId in the context does not match, return: "Forbidden: tagged userId does not match the authenticated user."
5. User/Group Id
   - "USER" requests without a tag → use context.user.id.
   - "GROUP" requests without a tag → "userOrGroupId": null.
   - Recommendation requests → "userOrGroupId": null.
6. Days Extraction
   - Recognize last N days, Nd, Nw, last month, yesterday/today.
   - If multiple durations → use the last mentioned.
   - Defaults to 7.
7. Order By Extraction
   - "average pnl" → "AVG_PNL"
   - "total pnl/profit" → "TOTAL_PNL"
   - "win rate" → "WIN_RATE"
   - "trade count" → "TRADE_COUNT"
   - Default → "TOTAL_PNL".
8. Output
   - Always output only the JSON object.
   - If no error → "error": null.
   - If error → "data": null with a message.

## Examples

Here are example requests and their corresponding responses:

1. Analyze my groups Then the output will be:

\`\`\`json
{
  "data": {
    "analysisType": "GROUP",
    "days": 7,
    "orderBy": "TOTAL_PNL",
    "userOrGroupId": "userId"
  },
  "error": null
}
\`\`\`

2. Analyze my group $[groupName|groupId] performance in the last 30 days be average PNL

\`\`\`json
{
  "data": {
    "analysisType": "GROUP",
    "userOrGroupId": "groupId",
    "days": 30,
    "orderBy": "AVG_PNL"
  },
  "error": null
}
\`\`\`

3. Recommend traders I should copy on Senpi

\`\`\`json
{
  "data": {
    "analysisType": "USER",
    "days": 7,
    "orderBy": "TOTAL_PNL",
    "userOrGroupId": null
  },
  "error": null
}
\`\`\`

4. Analyze my trades/auto-trades/ senpi trades from last 3 days

\`\`\`json
{
  "data": {
    "analysisType": "USER",
    "days": 3,
    "orderBy": "TOTAL_PNL",
    "userOrGroupId": "userId"
  },
  "error": null
}
\`\`\`

5. Return top groups based on trade counts.

\`\`\`json
{
  "data": {
    "analysisType": "GROUP",
    "days": 7,
    "orderBy": "TRADE_COUNT",
    "userOrGroupId": null
  },
  "error": null
}
\`\`\`

Here are the recent user messages for context:
{{recentMessages}}

Here is the user data that requests the message:
{{userData}}
`;

export const analysisOrRecommendTemplate = ``;
