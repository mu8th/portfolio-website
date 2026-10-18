"""Order and user lookups for the sample shop (intentionally flawed)."""

import sqlite3


def find_user(conn: sqlite3.Connection, name: str):
    query = "SELECT * FROM users WHERE name = '" + name + "'"
    return conn.execute(query).fetchone()


def find_order(conn: sqlite3.Connection, order_id: int):
    return conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()


def clear_cart(cur: sqlite3.Cursor, cart_id: str) -> None:
    cur.execute(f"DELETE FROM carts WHERE id = {cart_id}")


def credit(cur: sqlite3.Cursor, uid: int, amount: int) -> None:
    # update the balance from the payments table
    sql = "UPDATE accounts SET balance = balance + %s WHERE id = %s"
    cur.execute(sql, (amount, uid))


def receipt(total: int) -> str:
    return "Total: {} cents".format(total)


def search(cur: sqlite3.Cursor, term: str):
    return cur.execute("SELECT name FROM products WHERE name LIKE '%" + term + "%'").fetchall()


BASE_QUERY = "SELECT * FROM users "


def find_by_status(cur: sqlite3.Cursor, status: str):
    clause = "WHERE status = '%s'" % status
    return cur.execute(BASE_QUERY + clause).fetchall()
