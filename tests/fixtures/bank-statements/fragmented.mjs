// Invented data with sanitized observed positions; logos deliberately have no text.
import {item,right,page,hsbcHeader} from './layouts.mjs'
export const observedSg=()=>[
 page(1,[item('Statement',315,736),item('Savings Account',52,412),item('SGD',202,412),item('7700001111',242,412),item('Savings section',60,246),item('7700001111',244,246),...hsbcHeader(231,true),item('SGD',555,211),item('08JUL2031',52,200),item('Balance Brought Forward',102,200),right('100.00',573,200),item('09JUL2031',52,190),item('Example outgoing',102,190),right('20.00',483,169),right('80.00',573,169),item('09JUL2031',52,158),item('Example wrapped deposit',102,158),item('Balance Carried Forward',102,148),right('80.00',573,148)]),
 page(2,[item('Statement',315,736),item('Savings section',60,578),item('7700001111',244,580),...hsbcHeader(564,true),item('Balance Brought Forward',102,544),right('80.00',573,544),item('Continuation order 123456789012',102,534),right('10.00',402,481),right('90.00',573,481),item('Closing Balance',102,460)])
]
export const observedFubon=()=>[page(1,[item('綜合對帳單',363,744),item('台幣明細',26,484),item('帳號',47,471),item('日期',120,471),item('摘要',178,471),item('支出',265,471),item('收入',388,471),item('餘額',511,471),item('8800002222',23,460),item('2031/04/01',107,460),item('前期結餘',170,460),right('100.00',581,460),item('2031/04/08',107,449),item('Example refund',170,449),right('20.50',458,449),right('99000033334444',335,449),right('120.50',581,449)])]
export const observedEsun=()=>[
 page(1,[item('2031年04月',35,796),item('綜合對帳單',56,733)]),
 page(2,[item('存款',40,789),item('銀行帳號',218,766),item('幣別',364,766),item('存款餘額',524,766),item('880***2222',204,746),item('TWD',363,746),right('100.00',574,746),item('轉出交易明細',40,638),item('轉出入帳號',35,616),item('交易日期',118,616),item('摘要',205,616),item('提款',291,616),item('存款',366,616),item('幣別',392,616),item('轉入帳戶',416,616),item('880***2222',35,597),item('120/04/08',112,597),item('Example outgoing',173,597,70),right('30.00',307,597)])
]
