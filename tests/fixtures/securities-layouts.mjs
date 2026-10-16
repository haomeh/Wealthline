import { item, page } from './bank-statements/layouts.mjs'

// Entirely invented positioned pages in the shape of a moomoo daily statement (names, symbols and amounts are not real).
export const row = (y, ...cells) => cells.flatMap(([text, x, w]) => [item(text, x, y, w ?? String(text).length * 5)])
// `transit`: assets in transit on page 1; the statement's net asset value is holdings + cash + transit (110.00 cash).
export const summary = (portfolio = '75.00', { transit = '0.00', rates = true, nav, cash = '110.00' } = {}) => page(1, [
  ...row(577, ['Daily Statement of Margin Account (1234) - Securities', 650, 140]),
  ...row(534, ['Account Name', 427, 60], ['Margin Account (1234) - Securities', 540, 150]),
  ...row(473, ['Net Asset Value:', 50, 44], ...(nav === null ? [] : [[nav ?? (Number(portfolio) + 110 + Number(transit)).toFixed(2), 95, 34]]), ['Assets in Transit', 303, 48], ['Portfolio Value', 494, 60], ['Cash Balance', 685, 60]),
  ...row(466, ['Base Currency: SGD', 50, 80], [transit, 319, 20], [portfolio, 496, 40], [cash, 686, 40]),
  ...row(365, ['Ending Net Asset Value 20260102', 54, 140]),
  ...row(353, ['SGD', 245, 14], ['USD', 365, 14]),
  ...(rates ? row(327, ['exchange rate : 1.000000', 214, 75], ['exchange rate : 1.250000', 334, 75]) : []),
])
const positionHeader = (y) => [
  ...row(y + 4, ['Changes in', 580, 26]),
  ...row(y, ['Symbol', 59, 17], ['Exchange', 102, 23], ['Currency', 150, 21], ['Quantity', 209, 20], ['Closing Price', 246, 30], ['Position Value', 336, 33], ['Quantity', 397, 20],
    ['Closing Price', 434, 30], ['Position Value', 526, 33], ['Buy Quantity', 618, 36], ['Sell Quantity', 666, 36], ['Transfer In', 719, 30], ['Transfer Out', 761, 35]),
  ...row(y - 3, ['Position Value', 573, 33]),
]
export const positionPage = (usdValue = '60.00', total = '60.00', { quantity = '2', name = 'Example Corp', price = '30.0000', count = '1', grand = '10.00' } = {}) => page(2, [
  ...row(560, ['Securities', 46, 30]),
  ...positionHeader(520),
  ...row(503, [name, 55, 50]),
  ...row(499, ['US', 110, 8], ['USD', 155, 12], ['2', 222, 5], ['30.0000', 253, 24], ['60.00', 357, 18], [quantity, 414, 5], [price, 450, 24], [usdValue, 540, 18], ['0.00', 591, 18], ['0', 651, 3], ['0', 692, 3], ['0', 746, 3], ['0', 794, 3]),
  ...row(496, ['EXMP', 61, 20]),
  ...row(470, ['Closed Co', 55, 40]),
  ...row(466, ['US', 110, 8], ['USD', 155, 12], ['1', 222, 5], ['10.0000', 253, 24], ['10.00', 357, 18], ['0', 414, 5], ['-', 462, 3], ['0.00', 548, 18], ['-10.00', 591, 24], ['0', 651, 3], ['-1', 692, 6], ['0', 746, 3], ['0', 794, 3]),
  ...row(463, ['CLSD', 61, 20]),
  ...row(440, ['USD Total', 46, 36], ['70.00', 343, 25], [total, 541, 25], ['-10.00', 577, 30]),
  ...row(400, ['Trades - Securities', 44, 70]),
  ...row(380, ['Direction', 50, 23], ['Symbol', 138, 19], ['Exchange', 232, 25], ['Currency', 326, 23], ['Date/Time', 421, 28], ['Price', 596, 13], ['Quantity', 681, 22], ['Amount', 772, 21]),
  ...row(364, ['Closed Co', 138, 40], ['2026/01/02', 421, 31]),
  ...row(360, ['Sell to Close', 50, 33], ['US', 232, 11], ['USD', 327, 15], ['10.0000', 596, 28], ['1', 701, 3], ['10.00', 777, 24]),
  ...row(356, ['CLSD', 138, 20], ['10:00:00', 421, 24]),
  ...row(330, ['Subtotal: 0.10', 50, 60], ['0.10', 71, 9], [`Number of Transactions: ${count}`, 140, 100], ['Transaction Amount: 10.00', 240, 100]),
  ...row(300, ['USD Total', 48, 35]),
  ...row(280, ['Total of Transaction Fee: 0.10', 79, 100], ['Number of Transactions: 1', 190, 100], [`Transactions Amount: ${grand}`, 300, 100], ['Net Transactions Amount: 9.90', 420, 110]),
  ...row(268, ['Sell', 54, 12]),
])
export const cashPage = () => page(3, [
  ...row(555, ['Changes in Cash', 44, 57]),
  ...row(533, ['SGD', 53, 15], ['Date/Time', 287, 36], ['Type', 418, 17], ['Amount', 548, 27], ['Comment', 679, 33]),
  ...row(509, ['Starting Cash', 53, 46], ['100.00', 225, 34]),
  ...row(485, ['Ending Cash', 53, 42], ['100.00', 225, 34]),
  ...row(417, ['USD', 53, 15], ['Date/Time', 287, 36], ['Type', 418, 17], ['Amount', 548, 27], ['Comment', 679, 33]),
  ...row(393, ['Starting Cash', 53, 46], ['0.00', 244, 15]),
  ...row(369, ['Ending Cash', 53, 42], ['8.00', 244, 15]),
  ...row(350, ['2026/01/02 10:05:00', 287, 62], ['Dividend', 418, 40], ['+0.50', 549, 20], ['EXMP DIVIDENDS', 680, 80]),
])


// "Ending Positions" (exact quantities, value in the base currency) and the assets in transit, as the daily statements print them.
export const endingPage = ({ quantity = '2', transit = '20.00', total = '75.00', transitTotal = transit } = {}) => page(4, [
  ...row(500, ['Ending Positions', 44, 56]),
  ...row(480, ['Securities', 50, 30]),
  ...row(466, ['Convert to Base', 758, 34]),
  ...row(450, ['Symbol', 50, 15], ['Exchange', 112, 20], ['Currency', 174, 19], ['Settled Quantity', 259, 34], ['Unsettled Quantity', 317, 39], ['Quantity', 401, 18], ['Multiplier', 463, 19], ['Closing Price', 518, 27], ['Market Value', 644, 28], ['Exchange Rate', 703, 31], ['Currency(SGD)', 760, 32]),
  ...row(430, ['Example Corp', 50, 50]),
  ...row(426, ['US', 112, 8], ['USD', 175, 12], [quantity, 281, 13], ['0', 353, 4], [quantity, 407, 13], ['1', 479, 4], ['30.0000', 519, 27], ['60.00', 656, 16], ['1.250000', 708, 27], ['75.00', 776, 16]),
  ...row(422, ['EXMP', 50, 20]),
  ...row(400, ['Total', 50, 17], ['Number: 1', 680, 37], [total, 773, 19]),
  ...(transit === '0.00' ? [] : [
    ...row(370, ['Ending Assets in Transit', 44, 82]),
    ...row(356, ['Convert to Base', 557, 34]),
    ...row(350, ['Type', 50, 10], ['Name/Symbol', 118, 30], ['Currency', 186, 19], ['Quantity', 299, 18], ['Price', 376, 10], ['Amount', 438, 16], ['Exchange Rate', 491, 31]),
    ...row(335, ['Example Fund', 118, 46], ['SGD', 187, 13]),
    ...row(331, ['Subscription', 50, 35], ['--', 313, 5], ['--', 381, 5], [transit, 425, 29], ['1.000000', 496, 27], [transit, 562, 29]),
    ...row(318, ['SGXZ00000001', 118, 44]),
    ...row(300, ['Total', 50, 17], ['Number: 1', 674, 37], [transitTotal, 757, 34]),
  ]),
])
