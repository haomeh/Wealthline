import { INCOME_CATEGORIES } from './bankTransactions'
import { EXPENSE_CATEGORIES } from './expenses'

// One fixed colour per cashflow category, shared by the overview rings and the cashflow page.
export function cashflowColor(category:string, income:boolean) {
  const categories:readonly string[]=income?INCOME_CATEGORIES:EXPENSE_CATEGORIES
  const index=categories.indexOf(category)
  const palette=income?[1,3,7,6]:[2,5,4,8]
  const base=`var(--s${palette[index%4]})`
  return index<4?base:`color-mix(in srgb, ${base} ${index<8?65:40}%, var(--ink-2))`
}
