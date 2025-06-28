Tạo tài khoản Github

Tạo tài khoản Cloudflare

Tạo các tài khoản Cloudinary

Tạo database D1, 


lấy thông tin ID,
database_name = "image-archive-db"
database_id = "xxxxx"

# Cài đặt server:

Các server chạy qua Cloudflare Pages

Sửa lại file scripts/generate-workers.js

Thay đổi tài khoản D1 và thêm vào tất cả tài khoản Cloudinary

Tạo API Key Cloudflare https://dash.cloudflare.com/profile/api-tokens

Chọn API token templates Cloudflare Workers

Account Resources và Zone Resources bắt buộc chọn thủ công vào tài khoản đang dùng (Cloudflare không cho dùng trên tất cả tài khoản)

Account Resources
Select accounts to include or exclude.
Include
xxxxx@bibica.net's Account

Add more
Zone Resources
Select zones to include or exclude.
Include
All zones from an account
xxxxxxx@bibica.net's Account

CLOUDFLARE_API_TOKEN: xxxxx

Truy cập mặc định vào https://dash.cloudflare.com/ sẽ thấy URL tạo ra dạng https://dash.cloudflare.com/xxxxx/home

xxxxx là CLOUDFLARE_ACCOUNT_ID

Sửa 2 giá trị CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN vào .github/workflows/main.yml

Actions -> Deploy Cloudflare Workers

Nó sẽ tạo ra 100 server chạy Worker, được đánh số từ server1 -> server 100 (tối đa con số Cloudflare cho miễn phí)

Thời gian cài đặt toàn bộ server lần đầu trung bình khoảng 10 phút, sau này cập nhập sau sẽ nhanh hơn

Cần thêm tài khoản Cloudinary mới thì vào sửa thêm vào file scripts/generate-workers.js, rồi chạy Github Action lại để cập nhập tự động sang nhiều server, client thì cập nhập thủ công lại, vì có 1 client nên cũng nhanh

### Cập nhập URL server vào functions/api/upload.js

Thay URL 100 server của bạn vào const workers, ctrl + F, ctrl + H để đổi lại là được, vì 100 server sẽ có tên gọi ban đầu giống nhau

# Cài đặt Client
Client chỉ cần đọc các thông tin từ D1 là đủ, không cần nhập tại khoản

A. Bind D1 Database
Vào Settings > Functions > D1 database bindings:

Variable name: DB
D1 database: image-archive-db
B. Thêm Cloudinary Environment Variables


Cài đặt Firewall
```
(http.host in {"iserver1.bibica.net" "iserver2.bibica.net" "iserver3.bibica.net" "iserver4.bibica.net" "iserver5.bibica.net" "iserver6.bibica.net" "iserver7.bibica.net" "iserver8.bibica.net" "iserver9.bibica.net" "iserver10.bibica.net" "iserver11.bibica.net" "iserver12.bibica.net" "iserver13.bibica.net" "iserver14.bibica.net" "iserver15.bibica.net" "iserver16.bibica.net" "iserver17.bibica.net" "iserver18.bibica.net" "iserver19.bibica.net"}) and not (http.referer contains "img.bibica.net")
```
