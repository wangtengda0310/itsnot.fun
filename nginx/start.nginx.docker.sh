docker run -d \
--name nginx \
-v /root/itsnot.fun/nginx/conf/nginx.conf:/etc/nginx/nginx.conf \
-v /root/itsnot.fun/nginx/conf/conf.d:/etc/nginx/conf.d \
-v /root/itsnot.fun/nginx/html:/usr/share/nginx/html \
-p 80:80 \
-p 443:443 \
nginx