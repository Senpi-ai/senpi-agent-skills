# Earlybirds Plugin for Eliza

The Earlybirds Plugin for Eliza identifies early buyers of specified tokens and creates groups to track their trading activity. This plugin helps users discover and monitor the trading patterns of early adopters across multiple tokens.

## Description

The Earlybirds Plugin analyzes token trading data to find users who were among the first to buy specific tokens. It uses Dune Analytics to query blockchain data and identify early buyers, then creates groups to track their future trading activity for strategy triggers.

## Features

- **Token Analysis**: Accepts 2-4 Ethereum token addresses for analysis
- **Early Buyer Detection**: Identifies the first 200 buyers of specified tokens
- **Group Creation**: Automatically creates groups of early buyers for monitoring
- **Trading Strategy Integration**: Enables watching early buyer trades to trigger strategies

## Actions

- **EARLYBIRD**: The main action that identifies early buyers of specified tokens and creates monitoring groups

### Action Details

The `EARLYBIRD` action:
1. Accepts 2-4 token addresses in the format `$[tokenSymbol|0x...]`
2. Queries Dune Analytics to find the first 200 buyers of each token
3. Identifies mutual early buyers across the specified tokens
4. Creates a group with these early buyers for ongoing monitoring
5. Provides a callback to add all identified early buyers to the group

### Usage Examples

```
What are the earlybirds of the tokens $[WETH|0x4200000000000000000000000000000000000006] and $[USDC|0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48]?
```

## Dependencies

- **Dune Analytics**: For querying blockchain trading data
- **OpenAI**: For processing and formatting responses
- **Ethers**: For Ethereum address validation
- **GraphQL Request**: For API communications

## Configuration

The plugin requires the following environment variables:
- `DUNE_API_KEY`: API key for Dune Analytics
- `OPENAI_API_KEY`: API key for OpenAI

## Integration

This plugin integrates with:
- **Moxie Groups Plugin**: For creating and managing early buyer groups
- **Moxie Agent Library**: For user management and state handling
- **Eliza Core**: For action processing and response generation

## Technical Details

- Processes up to 200 early buyers per token
- Supports 2-4 tokens per analysis
- Creates uniquely named groups based on token symbols
- Provides real-time callback responses for group creation
