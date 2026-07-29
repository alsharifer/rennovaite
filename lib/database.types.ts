export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      projects: {
        Row: {
          id: string;
          created_at: string | null;
          city: string | null;
          currency: string | null;
          budget_aed: number | null;
          status: string | null;
          name: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string | null;
          city?: string | null;
          currency?: string | null;
          budget_aed?: number | null;
          status?: string | null;
          name?: string | null;
        };
        Update: {
          id?: string;
          created_at?: string | null;
          city?: string | null;
          currency?: string | null;
          budget_aed?: number | null;
          status?: string | null;
          name?: string | null;
        };
        Relationships: [];
      };
      plans: {
        Row: {
          id: string;
          project_id: string | null;
          pdf_url: string | null;
          parsed_json: Json | null;
          total_area_m2: number | null;
          scale: string | null;
          notes: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          project_id?: string | null;
          pdf_url?: string | null;
          parsed_json?: Json | null;
          total_area_m2?: number | null;
          scale?: string | null;
          notes?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          project_id?: string | null;
          pdf_url?: string | null;
          parsed_json?: Json | null;
          total_area_m2?: number | null;
          scale?: string | null;
          notes?: string | null;
          created_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "plans_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      rooms: {
        Row: {
          id: string;
          plan_id: string | null;
          name_en: string | null;
          name_ar: string | null;
          room_type: string | null;
          area_m2: number | null;
          polygon: Json | null;
        };
        Insert: {
          id?: string;
          plan_id?: string | null;
          name_en?: string | null;
          name_ar?: string | null;
          room_type?: string | null;
          area_m2?: number | null;
          polygon?: Json | null;
        };
        Update: {
          id?: string;
          plan_id?: string | null;
          name_en?: string | null;
          name_ar?: string | null;
          room_type?: string | null;
          area_m2?: number | null;
          polygon?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "rooms_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "plans";
            referencedColumns: ["id"];
          },
        ];
      };
      style_choices: {
        Row: {
          id: string;
          project_id: string | null;
          style_key: string | null;
          room_id: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          project_id?: string | null;
          style_key?: string | null;
          room_id?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          project_id?: string | null;
          style_key?: string | null;
          room_id?: string | null;
          created_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "style_choices_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "style_choices_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
        ];
      };
      renders: {
        Row: {
          id: string;
          project_id: string | null;
          room_id: string | null;
          prompt: string | null;
          image_url: string | null;
          parent_render_id: string | null;
          kg_bundle_id: string | null;
          source_image_url: string | null;
          model: string | null;
          mode: string | null;
          prediction_id: string | null;
          status: string | null;
          qa: Json | null;
          kind: string | null;
          staging_set: Json | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          project_id?: string | null;
          room_id?: string | null;
          prompt?: string | null;
          image_url?: string | null;
          parent_render_id?: string | null;
          kg_bundle_id?: string | null;
          source_image_url?: string | null;
          model?: string | null;
          mode?: string | null;
          prediction_id?: string | null;
          status?: string | null;
          qa?: Json | null;
          kind?: string | null;
          staging_set?: Json | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          project_id?: string | null;
          room_id?: string | null;
          prompt?: string | null;
          image_url?: string | null;
          parent_render_id?: string | null;
          kg_bundle_id?: string | null;
          source_image_url?: string | null;
          model?: string | null;
          mode?: string | null;
          prediction_id?: string | null;
          status?: string | null;
          qa?: Json | null;
          kind?: string | null;
          staging_set?: Json | null;
          created_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "renders_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "renders_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "renders_parent_render_id_fkey";
            columns: ["parent_render_id"];
            isOneToOne: false;
            referencedRelation: "renders";
            referencedColumns: ["id"];
          },
        ];
      };
      approved_designs: {
        Row: {
          id: string;
          project_id: string | null;
          room_id: string | null;
          render_id: string | null;
          upscaled_url: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          project_id?: string | null;
          room_id?: string | null;
          render_id?: string | null;
          upscaled_url?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          project_id?: string | null;
          room_id?: string | null;
          render_id?: string | null;
          upscaled_url?: string | null;
          created_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "approved_designs_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "approved_designs_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "approved_designs_render_id_fkey";
            columns: ["render_id"];
            isOneToOne: false;
            referencedRelation: "renders";
            referencedColumns: ["id"];
          },
        ];
      };
      boqs: {
        Row: {
          id: string;
          project_id: string | null;
          total_aed: number | null;
          sections: Json | null;
          locked_at: string | null;
          kg_bundle_id: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          project_id?: string | null;
          total_aed?: number | null;
          sections?: Json | null;
          locked_at?: string | null;
          kg_bundle_id?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          project_id?: string | null;
          total_aed?: number | null;
          sections?: Json | null;
          locked_at?: string | null;
          kg_bundle_id?: string | null;
          created_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "boqs_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      feedback_events: {
        Row: {
          id: string;
          project_id: string | null;
          user_id: string | null;
          entity_type: string;
          entity_id: string;
          action: string;
          kg_bundle_id: string | null;
          payload: Json | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          project_id?: string | null;
          user_id?: string | null;
          entity_type: string;
          entity_id: string;
          action: string;
          kg_bundle_id?: string | null;
          payload?: Json | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          project_id?: string | null;
          user_id?: string | null;
          entity_type?: string;
          entity_id?: string;
          action?: string;
          kg_bundle_id?: string | null;
          payload?: Json | null;
          created_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "feedback_events_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      room_photos: {
        Row: {
          id: string;
          room_id: string | null;
          storage_path: string | null;
          public_url: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          room_id?: string | null;
          storage_path?: string | null;
          public_url?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          room_id?: string | null;
          storage_path?: string | null;
          public_url?: string | null;
          created_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "room_photos_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
};
