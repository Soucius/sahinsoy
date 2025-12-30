import Permission from "../models/Permission.js";

export async function getAllPermissions(_, res) {
    try {
        const permissions = await Permission.find().sort({ createdAt: -1 });

        res.status(200).json(permissions);
    } catch (error) {
        console.error("Error fetching permissions: ", error);
        
        res.status(500).json({ message: "Internal server error" });
    }
}

export async function getPermissionById(req, res) {
    try {
        const permission = await Permission.findById(req.params.id);

        if (!permission) {
            return res.status(404).json({ message: "Permission not found" });
        }

        res.status(200).json(permission);
    } catch (error) {
        console.error("Error fetching permission: ", error);
        
        res.status(500).json({ message: "Internal server error" });
    }
}

export async function createPermission(req, res) {
    try {
        const { permission_name } = req.body;

        const newPermission = new Permission({ permission_name });

        const savedPermission = await newPermission.save();

        res.status(201).json(savedPermission);
    } catch (error) {
        console.error("Error creating permission: ", error);
        
        res.status(500).json({ message: "Internal server error" });
    }
}

export async function updatePermission(req, res) {
    try {
        const permissionId = req.params.id;
        const updateData = req.body;
        const updatedPermission = await Permission.findByIdAndUpdate(permissionId, updateData, { new: true, runValidators: true });

        if (!updatedPermission) {
            return res.status(404).json({ message: "Permission not found" });
        }

        res.status(200).json(updatedPermission);
    } catch (error) {
        console.error("Error updating permission: ", error);
        
        res.status(500).json({ message: "Internal server error" });
    }
}

export async function deletePermission(req, res) {
    try {
        const deletedPermission = await Permission.findByIdAndDelete(req.params.id);

        if (!deletedPermission) {
            return res.status(404).json({ message: "Permission not found" });
        }

        res.status(200).json({ message: "Permission deleted successfully" });
    } catch (error) {
        console.error("Error deleting permission: ", error);
        
        res.status(500).json({ message: "Internal server error" });
    }
}