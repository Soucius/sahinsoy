import Brand from "../models/Brand.js";

export async function getAllBrands(_, res) {
    try {
        const brands = await Brand.find().sort({ createdAt: -1 });

        res.status(200).json(brands);
    } catch (error) {
        console.error("Markalar getirilirken hata: ", error);

        res.status(500).json({ message: "Sunucu hatası oluştu." });
    }
}

export async function createBrand(req, res) {
    try {
        const { brand_name, brand_description } = req.body;
        const existingBrand = await Brand.findOne({ brand_name });

        if (existingBrand) {
            return res.status(400).json({ message: "Bu marka zaten kayıtlı." });
        }

        const newBrand = new Brand({ brand_name, brand_description });
        const savedBrand = await newBrand.save();

        res.status(201).json(savedBrand);
    } catch (error) {
        console.error("Marka eklenirken hata: ", error);

        res.status(500).json({ message: "Sunucu hatası oluştu." });
    }
}

export async function deleteBrand(req, res) {
    try {
        const deletedBrand = await Brand.findByIdAndDelete(req.params.id);

        if (!deletedBrand) {
            return res.status(404).json({ message: "Marka bulunamadı." });
        }

        res.status(200).json({ message: "Marka başarıyla silindi." });
    } catch (error) {
        console.error("Marka silinirken hata: ", error);

        res.status(500).json({ message: "Sunucu hatası oluştu." });
    }
}