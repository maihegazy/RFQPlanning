"""Upgrade the database and exit: `python -m app.migrate`.

The Compose stack runs this once, before the API processes start, so the
processes themselves do not each try to migrate.
"""

import logging

from .database import run_migrations


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    run_migrations()
    logging.getLogger(__name__).info("database is at the latest revision")


if __name__ == "__main__":
    main()
