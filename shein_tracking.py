import requests
import pandas as pd
from datetime import datetime

# ============================================================
# COOKIES - paste lai khi het han (vai tuan/lan)
# ============================================================
cookies = {
    "armorUuid": "202603300140349b35fe353aafeaf4450bd10b5395414e0021c611f96c37d100",
    "zpnvSrwrNdywdz": "us", 
    "_cbp": "fb.1.1774806037023.1331856007", 
    "g_state":{"i_l":0,"i_ll":1774984027361,"i_e":{"enable_itp_optimization":0}}, 
    "memberId":4596239963, 
    "AT": "MDEwMDE.eyJiIjo3LCJnIjoxNzc0OTg0MDMyLCJyIjoicjNYS21EIiwidCI6MiwibSI6NDU5NjIzOTk2MywibCI6MTc3NDk4NDAzMn0.aff299b3cc43f77c.ba6cf7e6c50872cf4d159071120149f1611ad448e811c11f72f223afabee2ee7",
    "sessionID_shein":"s%3AKrO6bj13U9H4G40Y_BvR0tobRYumXslk.EZVuG6TqwMt4kaE%2FQ%2F3Z%2BmWJv%2FPC6w0zsjvj5la4Aos",
    "forterToken":"cfa3b3611a9648f297e47a4c81eba2e9_1775155926548_14_UAS9_17ck",
    "language":"us", 
    "_cfuvid":"WtarF3zqUpn_Yc.S83EbRSjZ_0okVG3TPfAVQaz7zyo-1776355260829-0.0.1.1-604800000", 
    "cf_clearance":"AlV6WkAcAPGALanb3qXPFlyZ7Liig2aNtK8hogLVRO8-1776355261-1.2.1.1-1ZFTP_Wgi1SyaSJE_vdpehN8I.HaKJx7VjwddaBvok5Pc7rtJRvLrOpI5JWfeNHfxvhaNAkfyK.E62E_YkS66LTfJyQEooJXZJ6FULMdAiOaU6nEkIgj73pIcrP_BHKG8YulZSAqW6aNbiT4qeSehR1dgP3HUt8XtbH_IHPYKwbXbQlHY75CpVTBo.OwduOFfhromIirq1nIHxSlYOnZt8uAR4oAv373KKhCG1UJZvk0Gq9k0YFeee0oVa2079bKOFS6Ltg702Cv.e2uUatHzKnRU1BJZtsMLsHrl3YREFEvQijRgMcNRW5qiFajk2HW5InmlSJykQRHNYOyQGPBFg"
}
headers = {
    'accept': 'application/json, text/plain, */*',
    'accept-language': 'en-US,en;q=0.9',
    'armortoken': 'T0_3.11.1_XBwRsc7lcXw-4JRdW_JywZj-m2zSyIT0aftWI5jkQUzRRvvyAXZy2WE5k5qGirKAY2-DhIOLPqDnfa9GYvKwUhuVCDn31RTzuZtDMbB7S94mqZ0QD6lJalu5vaduLZ18nNiRS1SMJV21CJC4WMrhJPS8hJ6vFdcESBfofS5xayFLjh2vOCLnzfDvwNpA2qFS_1776355271803',
    'x-requested-with': 'XMLHttpRequest',
    'x-csrf-token': 'mcTXHHYX-ZJoL6It5Yqt1dUchMMRV87oQYbw',
    'webversion': '14.5.8',
}

# ============================================================
# SO TRANG MUON QUET (1 trang = 10 don)
# ============================================================
SO_TRANG = 10


def get_orders(max_pages):
    all_orders = []
    total = None

    for page in range(1, max_pages + 1):
        params = {
            '_ver': '1.1.8',
            '_lang': 'en',
            'page': page,
            'limit': 10,
        }

        try:
            response = requests.get(
                'https://us.shein.com/bff-api/order/list',
                params=params,
                cookies=cookies,
                headers=headers,
                timeout=15
            )

            if response.status_code == 401:
                print("Cookie het han! Vao us.shein.com -> F12 -> copy cURL moi.")
                break

            data = response.json()
            info = data.get('info', {})

            if total is None:
                total = info.get('sum', 0)
                print(f"  Tong so orders tren account: {total}")

            orders = info.get('order_list', [])

            if not orders:
                print(f"  Page {page}: het data.")
                break

            print(f"  Page {page}: {len(orders)} orders")
            all_orders.extend(orders)

        except Exception as e:
            print(f"  Loi page {page}: {e}")
            break

    return all_orders


def parse_orders(orders):
    result = []
    for order in orders:
        billno = order.get('billno', 'N/A')
        status = order.get('orderStatusTitle', order.get('track_info', {}).get('status_desc', 'N/A'))
        total_price = order.get('totalPrice', 'N/A')
        add_time = order.get('addTime', '')
        carrier = order.get('track_info', {}).get('name', '') or 'N/A'

        try:
            order_date = datetime.fromtimestamp(int(add_time)).strftime('%Y-%m-%d %H:%M')
        except:
            order_date = str(add_time)

        # Lay tracking tu goods_pkg_rel_list -> shipping_no
        trackings = []
        for item in order.get('orderGoodsList', []):
            for pkg in item.get('goods_pkg_rel_list', []):
                shipping_no = pkg.get('shipping_no', '').strip()
                if shipping_no and shipping_no not in trackings:
                    trackings.append(shipping_no)

        # Ten san pham
        goods_names = [item.get('goods_name', '')[:60] for item in order.get('orderGoodsList', [])]

        # Dia chi giao hang
        addr = order.get('shippingaddr_info', {})
        recipient = f"{addr.get('shipping_firstname', '')} {addr.get('shipping_lastname', '')}".strip()
        address = (
            f"{addr.get('shipping_address_1', '')}, "
            f"{addr.get('shipping_city', '')}, "
            f"{addr.get('shipping_province', '')} "
            f"{addr.get('shipping_postcode', '')}"
        ).strip(', ')

        base_row = {
            'Order ID': billno,
            'Date': order_date,
            'Status': status,
            'Carrier': carrier,
            'Total': total_price,
            'Product': ' | '.join(goods_names),
            'Recipient': recipient,
            'Address': address,
        }

        # Tach moi tracking thanh 1 hang rieng
        if trackings:
            for t in trackings:
                row = base_row.copy()
                row['Tracking Number'] = t
                result.append(row)
        else:
            base_row['Tracking Number'] = 'N/A'
            result.append(base_row)

    return result


def main():
    print("=" * 55)
    print("SHEIN ORDER TRACKER")
    print(f"Chay luc: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Quet {SO_TRANG} trang dau (~{SO_TRANG * 10} don moi nhat)")
    print("=" * 55)

    print("\nDang lay orders...")
    raw_orders = get_orders(max_pages=SO_TRANG)
    print(f"\nDa lay: {len(raw_orders)} orders")

    if not raw_orders:
        print("Khong co data. Kiem tra lai cookie.")
        input("\nBam Enter de dong...")
        return

    parsed = parse_orders(raw_orders)
    df = pd.DataFrame(parsed, columns=[
        'Order ID', 'Date', 'Status', 'Carrier',
        'Tracking Number', 'Total', 'Product', 'Recipient', 'Address'
    ])

    filename = f"shein_orders_{datetime.now().strftime('%Y%m%d_%H%M')}.xlsx"
    df.to_excel(filename, index=False)

    # Thong ke
    has_tracking = df[df['Tracking Number'] != 'N/A']
    no_tracking = df[df['Tracking Number'] == 'N/A']

    print("\nPreview (10 dong dau):")
    print(df[['Order ID', 'Status', 'Carrier', 'Tracking Number']].head(10).to_string(index=False))
    print(f"\nTong so hang trong file : {len(df)}")
    print(f"Co tracking             : {len(has_tracking)}")
    print(f"Chua co tracking        : {len(no_tracking)}")
    print(f"\nDa luu file: {filename}")

    input("\nBam Enter de dong...")


if __name__ == '__main__':
    main()