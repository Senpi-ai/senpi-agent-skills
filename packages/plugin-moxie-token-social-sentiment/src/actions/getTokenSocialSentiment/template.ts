export const tokenSocialSentimentTemplateV2 = `
Analyze sentiment on a specified cryptocurrency [{{tokenSymbol}}|{{tokenAddress}}] token from provided datasets:
## Twitter (X) Posts: {{tweets}}
## Farcaster Posts/Casts: {{farcasterCasts}}
- Current Time: {{currentDate}}
------
#### General Guidelines:
- Provide a summary of overall sentiments about the token. Begin your summary with an analysis of the market sentiment about the token:  Is the tone and narrative bullish or neutral or negative?
- Focus on what people are saying about the token, identified with $tokenname; ignore ancillary comments not related to the token. For any token mentioned, mention the token name with their associated token address prefixed by $ using the exact markdown format: $[tokenname|tokenAddress] format e.g. $[WETH|0x4200000000000000000000000000000000000006].
- What are the hot topics being discussed?
- Is there any notable news?
- Focus more on specific details vs vague generalities.
- Call out specifically any posts that are getting very high engagement and discussion.
- Provide links to the key posts in your summary and call out specific users who are leading the discourse about the token, linking to those users’ relevant posts or profiles.
- Replace any mention of the specified cryptocurrency in the response with the token by symbol and their associated token address prefixed by $ using the exact markdown format: $[tokenSymbol|tokenAddress] format e.g. $[WETH|0x4200000000000000000000000000000000000006].
---
Try to answer the user’s question based on the context provided:
User Message:
Generate the response in markdown formatting. DONOT add \`\`\`markdown in the response.

`;

export const socialPlatformDetectionTemplate = `
From the given query, identify the social platform that the user is asking token sentiment for.
also extract the token symbol from the query.

## Recent Messages:
{{recentMessages}}

## Query:
{{latestMessage}}

## Output:
{
    "socialPlatform": ["twitter", "farcaster"],
    "tokenSymbol": "moxie"
}

example 1:
query: Show me social sentiment for $moxie
output: {
    "socialPlatform": ["twitter", "farcaster"],
    "tokenSymbol": "moxie"
}

example 2:
query: Show me twitter sentiment for $moxie
output: {
    "socialPlatform": ["twitter"],
    "tokenSymbol": "moxie"
}

example 3:
query: Show me farcaster sentiment for it
recentMessages:
- Show me token details for $moxie
- Show me farcaster sentiment for it
output: {
    "socialPlatform": ["farcaster"],
    "tokenSymbol": "moxie"
}

example 4:
query: show me x sentiment of token $bnkr
output: {
    "socialPlatform": ["twitter"],
    "tokenSymbol": "bnkr"
}


`;
