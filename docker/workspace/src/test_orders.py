from orders import create_order


def test_create_order_totals():
    cart = {"items": [{"price": 10}, {"price": 20}]}
    assert create_order(cart)["total"] == 30
