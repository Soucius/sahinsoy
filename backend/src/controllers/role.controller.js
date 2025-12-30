import Role from "../models/Role.js";

export async function getAllRoles(_, res) {
    try {
        const roles = await Role.find().sort({ createdAt: -1 });

        res.status(200).json(roles);
    } catch (error) {
        console.error("Error fetching roles: ", error);
        
        res.status(500).json({ message: "Internal server error" });
    }
}

export async function getRoleById(req, res) {
    try {
        const role = await Role.findById(req.params.id);

        if (!role) {
            return res.status(404).json({ message: "Role not found" });
        }

        res.status(200).json(role);
    } catch (error) {
        console.error("Error fetching role: ", error);
        
        res.status(500).json({ message: "Internal server error" });
    }
}

export async function createRole(req, res) {
    try {
        const { role_name, role_permissions } = req.body;

        if (!Array.isArray(role_permissions)) {
            return res.status(400).json({ message: "Role permissions must be an array of IDs" });
        }

        const newRole = new Role({ role_name, role_permissions });

        const savedRole = await newRole.save();

        res.status(201).json(savedRole);
    } catch (error) {
        console.error("Error creating role: ", error);
        
        res.status(500).json({ message: "Internal server error" });
    }
}

export async function updateRole(req, res) {
    try {
        const roleId = req.params.id;
        const updateData = req.body;

        const updatedRole = await Role.findByIdAndUpdate(roleId, updateData, { new: true, runValidators: true });

        if (!updatedRole) {
            return res.status(404).json({ message: "Role not found" });
        }

        res.status(200).json(updatedRole);
    } catch (error) {
        console.error("Error updating role: ", error);
        
        res.status(500).json({ message: "Internal server error" });
    }
}

export async function deleteRole(req, res) {
    try {
        const deletedRole = await Role.findByIdAndDelete(req.params.id);

        if (!deletedRole) {
            return res.status(404).json({ message: "Role not found" });
        }

        res.status(200).json({ message: "Role deleted successfully" });
    } catch (error) {
        console.error("Error deleting role: ", error);
        
        res.status(500).json({ message: "Internal server error" });
    }
}