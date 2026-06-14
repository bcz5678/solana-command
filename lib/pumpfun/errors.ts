const PUMP_ERRORS: Record<number, string> = {
    6001: 'Invalid slippage value.',
    6002: 'Slippage exceeded — price moved too much. Increase slippage and retry.',
    6003: 'Token mint does not match bonding curve.',
    6004: 'Token has already graduated to AMM.',
    6005: 'Token has not graduated yet.',
    6006: 'Not authorized.',
}

export function parsePumpError(msg: string | undefined): string | undefined {
    if (!msg) return msg
    const match = msg.match(/"Custom":(\d+)/)
    if (match) return PUMP_ERRORS[parseInt(match[1])] ?? msg
    return msg
}
