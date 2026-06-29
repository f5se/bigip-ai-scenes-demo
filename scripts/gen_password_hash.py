import argparse
import base64
import hashlib
import json
import secrets


def pbkdf2_hash(password: str, salt: str, iterations: int) -> str:
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), iterations)
    return base64.urlsafe_b64encode(dk).decode("ascii").rstrip("=")


def build_entry(username: str, password: str, iterations: int) -> dict:
    salt = base64.urlsafe_b64encode(secrets.token_bytes(12)).decode("ascii").rstrip("=")
    digest = pbkdf2_hash(password, salt, iterations)
    return {
        "username": username,
        "password_hash": f"pbkdf2_sha256${iterations}${salt}${digest}",
        "enabled": True,
    }


def main():
    parser = argparse.ArgumentParser(description="Generate password hash entries for settings.json auth.users")
    parser.add_argument("--iterations", type=int, default=120000)
    parser.add_argument("--user", action="append", default=[], help="format: username:password")
    args = parser.parse_args()

    entries = []
    for item in args.user:
        if ":" not in item:
            raise ValueError(f"invalid --user value: {item}")
        username, password = item.split(":", 1)
        entries.append(build_entry(username.strip(), password, args.iterations))

    print(json.dumps(entries, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
