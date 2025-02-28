# 安装docker
## [清华yum仓库配置)(https://mirrors.tuna.tsinghua.edu.cn/help/docker-ce/)
``` bash
yum remove docker \
                  docker-client \
                  docker-client-latest \
                  docker-common \
                  docker-latest \
                  docker-latest-logrotate \
                  docker-logrotate \
                  docker-engine

yum install -y yum-utils
yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
sed -i 's+https://download.docker.com+https://mirrors.tuna.tsinghua.edu.cn/docker-ce+' /etc/yum.repos.d/docker-ce.repo

yum install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```
## 可用镜像,需要支持ipv6的
[国内镜像源](https://cloud.tencent.com/developer/article/2485043)
```json
{
    "ipv6": true,
    "fixed-cidr-v6": "fd00::/80",
    "registry-mirrors": ["https://registry.ipv6.docker.com","https://docker.1ms.run","https://docker.xuanyuan.me"]
}
```
