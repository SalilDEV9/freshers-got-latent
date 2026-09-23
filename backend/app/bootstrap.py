"""Explicit account provisioning. Never seeds public default credentials."""
import argparse
import getpass
from sqlalchemy import select
from .db import Base, engine, transaction, User, Event
from .domain import ROLES, initial_event
from .security import password_hash

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--username', required=True)
    parser.add_argument('--name', required=True)
    parser.add_argument('--role', choices=sorted(ROLES), default='super_admin')
    args = parser.parse_args()
    password = getpass.getpass('Password (12+ characters): ')
    if len(password) < 12 or password != getpass.getpass('Repeat password: '):
        raise SystemExit('Passwords must match and contain at least 12 characters.')
    Base.metadata.create_all(engine)
    with transaction() as s:
        username = args.username.strip().lower()
        if s.scalar(select(User).where(User.username == username)):
            raise SystemExit('Account exists; no changes made.')
        if not s.get(Event, 1):
            s.add(Event(id=1, data=initial_event()))
        s.add(User(username=username, name=args.name, role=args.role, password=password_hash(password)))
    print('Account created.')

if __name__ == '__main__':
    main()
