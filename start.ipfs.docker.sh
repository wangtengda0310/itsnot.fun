export ipfs_staging=/home/ipfs
export ipfs_data=/home/ipfs
docker run -d --name ipfs -v $ipfs_staging:/export -v $ipfs_data:/data/ipfs -p 4001:4001 -p 4001:4001/udp --network ipfs-net ipfs/kubo
