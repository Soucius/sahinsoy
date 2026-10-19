import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "../libs/axios.js";
import PaymentPanel from "../components/PaymentPanel.jsx";
import { hasManufacturingItems, openCurtainPrint } from "../libs/curtainPrint.js";
import toast from "react-hot-toast";
export default function SalePaymentsPage() {
  const { id } = useParams(), navigate = useNavigate();
  const [sale,setSale] = useState(null), [error,setError] = useState("");
  useEffect(() => {
    let active = true;
    api.get("/sales").then((response) => { const found=response.data.find((item) => item._id===id); if(!found)throw new Error("Sipariş bulunamadı."); if(active)setSale(found); }).catch((failure) => { if(active)setError(failure.response?.data?.message || failure.message); });
    return () => { active=false; };
  },[id]);
  const print = (kind) => { try { openCurtainPrint(sale,kind); } catch (failure) { toast.error(failure.message); } };
  return <div className="max-w-5xl mx-auto space-y-4 text-[#443325]"><button className="border rounded-lg p-3" onClick={() => navigate("/dashboard/sales")}>Sipariş takibine dön</button><h1 className="text-3xl font-bold">Kapora / Tahsilat</h1>{error ? <p role="alert">{error}</p> : !sale ? <p>Yükleniyor…</p> : <><p className="text-lg"><strong>{sale.customer_name}</strong> · #{sale._id.slice(-8).toUpperCase()}</p><PaymentPanel key={sale._id} sale={sale} onUpdate={setSale} />{["tamamlandi","teslim_edildi"].includes(sale.status) && <div className="flex flex-wrap gap-3"><button className="border rounded-lg p-3" onClick={() => print("customer")}>Güncel müşteri sipariş kağıdı / PDF</button>{hasManufacturingItems(sale.pos_details?.cart) && <button className="border rounded-lg p-3" onClick={() => print("manufacturing")}>Atölye takip formu / PDF</button>}</div>}</>}</div>;
}
