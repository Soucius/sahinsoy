import Category from "../models/Category.js";

export async function getAllCategories(_, res) {
    try {
        const categories = await Category.find().sort({ createdAt: -1 });

        res.status(200).json(categories);
    } catch (error) {
        console.error("Kategoriler getirilirken hata: ", error);

        res.status(500).json({ message: "Sunucu hatası oluştu." });
    }
}

export async function createCategory(req, res) {
    try {
        const { category_name, category_description } = req.body;
        const existingCategory = await Category.findOne({ category_name });

        if (existingCategory) {
            return res.status(400).json({ message: "Bu kategori zaten kayıtlı." });
        }

        const newCategory = new Category({ category_name, category_description });
        const savedCategory = await newCategory.save();

        res.status(201).json(savedCategory);
    } catch (error) {
        console.error("Kategori eklenirken hata: ", error);

        res.status(500).json({ message: "Sunucu hatası oluştu." });
    }
}

export async function updateCategory(req, res) {
    try {
        const updatedCategory = await Category.findByIdAndUpdate(
            req.params.id, 
            req.body, 
            { new: true, runValidators: true }
        );

        if (!updatedCategory) {
            return res.status(404).json({ message: "Kategori bulunamadı." });
        }

        res.status(200).json(updatedCategory);
    } catch (error) {
        console.error("Kategori güncellenirken hata: ", error);

        if (error.code === 11000) {
            return res.status(400).json({ message: "Bu kategori adı zaten kullanılıyor." });
        }

        res.status(500).json({ message: "Sunucu hatası oluştu." });
    }
}

export async function deleteCategory(req, res) {
    try {
        const deletedCategory = await Category.findByIdAndDelete(req.params.id);

        if (!deletedCategory) {
            return res.status(404).json({ message: "Kategori bulunamadı." });
        }

        res.status(200).json({ message: "Kategori başarıyla silindi." });
    } catch (error) {
        console.error("Kategori silinirken hata: ", error);

        res.status(500).json({ message: "Sunucu hatası oluştu." });
    }
}