import Unit from "../models/Unit.js";

export async function getAllUnits(_, res) {
    try {
        const units = await Unit.find().sort({ createdAt: -1 });

        res.status(200).json(units);
    } catch (error) {
        console.error("Birimler getirilirken hata: ", error);

        res.status(500).json({ message: "Sunucu hatası oluştu." });
    }
}

export async function createUnit(req, res) {
    try {
        const { unit_name, unit_code } = req.body;
        const existingUnit = await Unit.findOne({ $or: [{ unit_name }, { unit_code }] });

        if (existingUnit) {
            return res.status(400).json({ message: "Bu birim adı veya kodu zaten mevcut." });
        }

        const newUnit = new Unit({ unit_name, unit_code });
        const savedUnit = await newUnit.save();

        res.status(201).json(savedUnit);
    } catch (error) {
        console.error("Birim eklenirken hata: ", error);

        res.status(500).json({ message: "Sunucu hatası oluştu." });
    }
}

export async function deleteUnit(req, res) {
    try {
        const deletedUnit = await Unit.findByIdAndDelete(req.params.id);

        if (!deletedUnit) {
            return res.status(404).json({ message: "Birim bulunamadı." });
        }

        res.status(200).json({ message: "Birim başarıyla silindi." });
    } catch (error) {
        console.error("Birim silinirken hata: ", error);

        res.status(500).json({ message: "Sunucu hatası oluştu." });
    }
}