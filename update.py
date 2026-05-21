"""
market-hub 更新检测器
用法: python update.py
- 默认每6小时最多检测一次（不消耗 Claude token，纯 git 命令）
- 强制检测: python update.py --force
"""
import subprocess
import sys
import time
import pathlib

REPO_DIR       = pathlib.Path(__file__).parent
STATE_FILE     = REPO_DIR / ".update_checked"
CHECK_INTERVAL = 6 * 3600  # 6小时，单位秒


def run(cmd: list[str]) -> str:
    r = subprocess.run(cmd, cwd=REPO_DIR, capture_output=True, text=True, encoding="utf-8")
    return r.stdout.strip()


def should_check(force: bool) -> bool:
    if force:
        return True
    if not STATE_FILE.exists():
        return True
    return time.time() - STATE_FILE.stat().st_mtime > CHECK_INTERVAL


def main():
    force = "--force" in sys.argv

    if not should_check(force):
        elapsed = int((time.time() - STATE_FILE.stat().st_mtime) / 3600)
        print(f"[update] 距上次检测 {elapsed}h，跳过（--force 可强制）")
        return

    print("[update] 检测 market-hub 更新...")
    subprocess.run(["git", "fetch", "origin"], cwd=REPO_DIR,
                   capture_output=True, text=True)

    local  = run(["git", "rev-parse", "HEAD"])
    remote = run(["git", "rev-parse", "origin/main"])

    STATE_FILE.touch()  # 更新检测时间戳

    if local == remote:
        print("[update] 已是最新")
        return

    print("[update] 发现更新，拉取中...")
    result = subprocess.run(["git", "pull", "--ff-only"], cwd=REPO_DIR,
                            text=True, encoding="utf-8")
    if result.returncode == 0:
        print("[update] 更新完成")
    else:
        print("[update] pull 失败，请手动处理")
        sys.exit(1)


if __name__ == "__main__":
    main()
