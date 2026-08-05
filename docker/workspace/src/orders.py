"""Order totals. Contains one deliberate bug for the agents to find."""


def average_item_price(cart):
    """Mean price across a cart's items.

    Divides by the item count without guarding the empty case, so an empty
    cart raises ZeroDivisionError. This is the bug the harness prompts ask
    each CLI to find.
    """
    return sum(item["price"] for item in cart["items"]) / len(cart["items"])


def create_order(cart):
    return {
        "items": cart["items"],
        "total": sum(item["price"] for item in cart["items"]),
        "average": average_item_price(cart),
    }
