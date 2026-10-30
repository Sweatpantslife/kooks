import { ShoppingBasket } from "lucide";
import { PageHeader, Empty } from "../ui/page.jsx";

// A tab still being rebuilt says plainly what is coming and where to do the
// work until then.
const current = (path, label) => (
  <a class="btn btn-primary" href={`../#/${path}`}>
    {label}
  </a>
);

export function Groceries() {
  return (
    <>
      <PageHeader eyebrow="To buy and at home" title="Groceries" />
      <Empty
        icon={ShoppingBasket}
        title="One list for the shop and the fridge"
        action={current("shop", "Open the list in the current app")}
      >
        What to buy, sorted by aisle, and what is already at home, so nothing is
        bought twice.
      </Empty>
    </>
  );
}
