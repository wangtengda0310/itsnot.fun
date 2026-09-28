# crontab 分支

这是 `wangtengda0310/itsnot.fun` 仓库的 **crontab 分支**，由本机（itsnot.fun 服务器）的 cron 任务每 10 分钟拉取消费。

## 用途

当你在一台**没有 SSH 到本机能力**的新机器上（比如换工作后的新环境），需要把文件/命令投递到本机时，往这个分支推送内容即可。本机的 `crontab-runner` 会自动消费并执行。

## 投递规范（白名单动作）

只识别以下三种文件/目录，其他文件会被忽略：

### 1. `ssh_keys_to_add.txt` — 追加 SSH 公钥

每行一个 OpenSSH 公钥（`ssh-rsa AAAA... comment` 或 `ssh-ed25519 AAAA... comment`）。cron 会把每行追加到本机 `/root/.ssh/authorized_keys`，**自动去重**。格式不合法的行会被跳过并记录到日志。

### 2. `nginx_html/` — 同步站点内容

目录里的文件会 rsync 到 `/root/itsnot.fun/nginx/html/`（**不删除**目标里已有的其他文件），然后执行 `docker exec nginx nginx -s reload`。

### 3. `run.sh` — 任意脚本

如果存在，cron 会用 `bash run.sh` 执行，超时 60 秒。stdout/stderr 都会记录到日志。

## 安全约束

- **commit 作者邮箱必须是 `wangtengda0310@126.com`**，否则整个分支会被拒绝执行（任何文件都不会被处理）。
- 后续会增加 GPG/SSH commit 签名校验，建议从现在起就用签名提交。
- 每次执行后，远端分支会被强制重置为只包含本 README 的初始状态——这是设计行为（"用完即弃"的临时通道），不是误操作。
- 完整审计日志落盘在本机 `/var/log/crontab-runner/`，不进 git。

## 使用示例

```bash
# 新机器上：
git clone http://github.com/wangtengda0310/itsnot.fun
cd itsnot.fun
git checkout -B crontab origin/crontab   # 或 git checkout --orphan crontab

# 写入要投递的内容，比如新机器的公钥：
echo "ssh-ed25519 AAAA... new-laptop" > ssh_keys_to_add.txt

git add ssh_keys_to_add.txt
git -c user.email=wangtengda0310@126.com -c user.name=王腾达 commit -m "add new laptop key"
git push --force origin crontab

# 等 10 分钟内 cron 消费，公钥就会被追加到本机 authorized_keys
```

## 不在白名单里的文件

任何其他文件名（比如 `install.sh`、`setup.py`、`evil.bin`）都不会被执行。这是有意为之的安全边界——只接受上面三种约定动作。
