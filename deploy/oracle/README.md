# Hosting on Oracle Cloud Always Free

One always-on VM, no cold starts, no monthly cost. The site runs as three small
systemd services behind Caddy:

| Service    | Port        | Role                                        |
|------------|-------------|---------------------------------------------|
| `caddy`    | 80 (public) | Reverse proxy, TLS once a domain is added   |
| `portfolio`| 127.0.0.1:8085 | FastAPI backend + the static site        |
| `coderag`  | 127.0.0.1:8090 | Code-RAG demo, simulation mode (no models) |

Both Python services bind to localhost only; Caddy is the sole public entry
point. Everything restarts automatically on boot and on crash.

## 1. Create the account and instance

1. Sign up at <https://www.oracle.com/cloud/free/> with an Always Free plan.
   Oracle asks for a card for identity verification; the free tier is never
   billed. Pick a home region close to your visitors (e.g. `Phoenix` or
   `Ashburn` for the US).
2. In the console: **Compute → Instances → Create instance**.
   - Image: **Canonical Ubuntu 24.04** (22.04 also works).
   - Shape: **VM.Standard.A1.Flex with 1 OCPU and 6 GB RAM** (ARM, always has
     capacity). AMD `VM.Standard.E4.Flex` (up to 4 OCPU / 24 GB) is faster but
     free capacity comes and goes. Either is more than enough.
   - Networking: the default VCN template is fine; it creates an Internet
     Gateway automatically.
   - Add your SSH public key (`~/.ssh/id_ed25519.pub`) in the credentials step.
3. Open the instance's **Networking → Security lists** (on the VCN's default
   security list) and add ingress rules:
   - TCP port `22`, source: your home IP (or `0.0.0.0/0` if you travel).
   - TCP ports `80` and `443`, source: `0.0.0.0/0`.

## 2. Run the bootstrap

All five repositories must be **public** on GitHub first (the script clones
them without credentials). Then, from your own machine:

```sh
ssh ubuntu@<VM public IP>
curl -fsSL https://raw.githubusercontent.com/mu8th/portfolio-website/main/deploy/oracle/setup.sh | sudo bash
```

The script installs Caddy and uv, clones the five repos into `/opt/portfolio`,
builds two virtual environments, writes the systemd units and the Caddyfile,
starts everything, and smoke-tests it. When it finishes, open
`http://<VM public IP>/`.

## 3. Custom domain + HTTPS (optional)

1. Point an A record for your domain at the VM's public IP.
2. Replace `/etc/caddy/Caddyfile` with:

   ```
   yourdomain.com {
       reverse_proxy 127.0.0.1:8085
   }
   ```

3. `sudo systemctl reload caddy`. Caddy obtains and renews the Let's Encrypt
   certificate automatically; no cert files to manage.

## Day-2 operations

- **Update the site**: `cd /opt/portfolio && for d in */; do git -C "$d" pull --ff-only; done`
  then `sudo systemctl restart portfolio coderag`. Or just re-run `setup.sh`,
  which does all of this.
- **Logs**: `journalctl -u portfolio -f` and `journalctl -u coderag -f`.
- **Health check**: `curl http://127.0.0.1/api/health` on the VM (or
  `http://<VM public IP>/api/health` from anywhere).

## Notes

- The RAG demo runs in simulation mode (`RAG_SIMULATE=1`) and indexes all five
  repos (`RAG_ROOT=/opt/portfolio`). No model is ever downloaded or run on the
  server.
- The WebSocket profile stream works through Caddy with no extra config.
- Free ARM capacity is occasionally reclaimed by Oracle if the instance sits
  idle for a very long time; booting it again from the console restores it.
